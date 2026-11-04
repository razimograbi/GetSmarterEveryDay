import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  openDb, optimizeDb, upsertUser, deleteUser, saveRound, getStats, exportUser, finishedRounds,
  createSession, sessionUser, deleteSession, deleteUserSessions, purgeExpiredSessions,
  getSettings, saveSettings, saveReport, listReports, resolveReports, REPORT_STATUSES, logEvent, getRetention,
  ensureProfile, getProfile, saveProfile, setTimezone, profileByCode, shownProfile, randomCode,
  addFriend, removeFriend, areFriends, listFriends,
  getDaily, dailyResult, startDaily, finishDaily, dailyBoard, friendsBeaten,
  createDuel, getDuel, claimDuel, finishDuelSide, listDuels, openDuelCount, roundAnswers,
  savePushSubscription, deletePushSubscription,
} from './db.js';
import {
  verifyGoogleIdToken, sessionCookie, clearedCookie, parseCookies, SESSION_COOKIE, SESSION_TTL_MS,
} from './auth.js';
import { rateLimiter, clientIp, capacityGate } from './ratelimit.js';
import { QUESTION_BY_ID } from '../shared/questions.js';
import {
  MODES, DEFAULT_MODE, CATEGORY_BY_ID, REPORT_REASONS, REPORT_NOTE_MAX, EVENTS, DAILY, DUEL, pointsFor, secondsFor, localDate, dailyNumber,
} from '../shared/config.js';
import { legalPage, shareMeta } from './pages.js';
import { pickQuestions } from './pick.js';
import { loadVapidKeys, createReminders } from './push.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* no .env file */ }

const PRODUCTION = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
// The name-only sign-in gives anyone the account of whatever name they type, so it never runs in production.
const DEV_LOGIN = !PRODUCTION && (!GOOGLE_CLIENT_ID || process.env.DEV_LOGIN === '1');
const SECURE_COOKIES = process.env.SECURE_COOKIES ? process.env.SECURE_COOKIES === '1' : PRODUCTION;
const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data');
const DB_FILE = process.env.DB_FILE ? resolve(process.env.DB_FILE) : join(DATA_DIR, 'smarts.db');
// Set to 1 when the app runs behind a reverse proxy (Caddy, nginx, Fly.io) that sets X-Forwarded-For.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// Who can open the admin page: comma-separated Google emails (or user ids such as dev:razi).
const ADMINS = new Set((process.env.ADMIN_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
// How many players may use the app at once; more are shown a "full, try again soon" page.
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 100;
// A player's slot frees up after this long without any request.
const PLAYER_IDLE_MS = 10 * 60_000;

if (PRODUCTION) {
  const problems = [];
  if (!GOOGLE_CLIENT_ID) problems.push('GOOGLE_CLIENT_ID is not set, so nobody could sign in.');
  if (process.env.DEV_LOGIN === '1') problems.push('DEV_LOGIN=1 is not allowed: the name-only sign-in lets anyone open any account by typing its name.');
  if (problems.length) {
    console.error(`\n  Smarts won't start with NODE_ENV=production:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    process.exit(1);
  }
  if (TRUST_PROXY && HOST === '0.0.0.0') {
    console.warn('  TRUST_PROXY=1 but HOST=0.0.0.0: anyone who reaches Node directly can fake their address. Set HOST=127.0.0.1 so only the proxy can.');
  }
}

const db = openDb(DB_FILE);

// Expired sessions are useless; clear them out now and every hour. SQLite refreshes its query
// planner statistics at the same time (cheap, and keeps the boards' queries quick as data grows).
purgeExpiredSessions(db);
setInterval(() => {
  purgeExpiredSessions(db);
  optimizeDb(db);
}, 3_600_000).unref();

// Push reminders. The key pair is made once and kept in the data folder (or set VAPID_PUBLIC_KEY
// and VAPID_PRIVATE_KEY). Push services may use VAPID_SUBJECT to contact whoever runs the server.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@localhost';
if (PRODUCTION && !process.env.VAPID_SUBJECT) console.warn('  VAPID_SUBJECT is not set: push services want a contact, such as mailto:you@example.com.');
const reminders = createReminders({ db, keys: loadVapidKeys(join(DATA_DIR, 'vapid.json')), subject: VAPID_SUBJECT });
reminders.start();

// ── HTTP helpers ───────────────────────────────────────────────

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "frame-src https://accounts.google.com/gsi/",
  "connect-src 'self' https://accounts.google.com/gsi/ https://en.wikipedia.org https://cdn.jsdelivr.net https://unpkg.com",
  "img-src 'self' data: blob: https://flagcdn.com https://upload.wikimedia.org https://thumb.wikimedia.org https://server.arcgisonline.com https://*.googleusercontent.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "frame-ancestors 'none'", // no other site may show Smarts inside a frame
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const BASE_HEADERS = {
  'Content-Security-Policy': CSP,
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups', // needed by Google sign-in popups
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  // Production runs on HTTPS only: browsers then refuse plain HTTP for a year.
  ...(PRODUCTION ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(body);
}

function json(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
}

async function body(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be JSON'), { status: 400 });
  }
}

const sessionToken = (req) => parseCookies(req.headers.cookie)[SESSION_COOKIE];

function currentUser(req) {
  return sessionUser(db, sessionToken(req));
}

const isAdmin = (u) => !!u && (ADMINS.has(u.id.toLowerCase()) || (!!u.email && ADMINS.has(u.email.toLowerCase())));

const publicUser = (u) => u && {
  id: u.id, name: u.name, email: u.email, picture: u.picture, provider: u.provider, since: u.created_at, admin: isAdmin(u),
};

/**
 * Starts a new session for `user` and replies with the user and their settings. `locale` is
 * the language of their Google account when Google shares it, used only as a hint.
 */
function signIn(res, user, locale = null) {
  const token = createSession(db, user.id, SESSION_TTL_MS);
  json(res, 200, {
    user: publicUser(user), settings: getSettings(db, user.id), profile: ensureProfile(db, user), played: finishedRounds(db, user.id), locale,
  }, {
    'Set-Cookie': sessionCookie(token, { secure: SECURE_COOKIES }),
  });
}

// ── API ────────────────────────────────────────────────────────

const routes = {
  // For uptime checks by the host. Not rate limited and always answered, even when full.
  'GET /api/health': (req, res) => {
    db.prepare('SELECT 1').get(); // throws (500) if the database is unusable
    json(res, 200, { ok: true, players: capacity.active(), maxPlayers: MAX_PLAYERS });
  },

  'GET /api/config': (req, res) =>
    json(res, 200, { googleClientId: GOOGLE_CLIENT_ID || null, devLogin: DEV_LOGIN, pushKey: reminders.publicKey }),

  'GET /api/me': (req, res) => {
    const user = currentUser(req);
    json(res, 200, {
      user: publicUser(user), settings: user ? getSettings(db, user.id) : null, profile: user ? ensureProfile(db, user) : null,
      played: user ? finishedRounds(db, user.id) : 0, // rounds finished: 0 shows the new-player home
    });
  },

  'POST /api/auth/google': async (req, res) => {
    if (!GOOGLE_CLIENT_ID) return json(res, 400, { error: 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID in .env.' });
    const { credential } = await body(req);
    let claims;
    try {
      claims = await verifyGoogleIdToken(credential, GOOGLE_CLIENT_ID);
    } catch (err) {
      return json(res, 401, { error: `Google sign-in failed: ${err.message}` });
    }
    const user = upsertUser(db, {
      id: `google:${claims.sub}`,
      email: claims.email,
      name: claims.given_name || claims.name || claims.email?.split('@')[0] || 'Player',
      picture: claims.picture,
      provider: 'google',
    });
    signIn(res, user, typeof claims.locale === 'string' ? claims.locale.slice(0, 20) : null);
  },

  'POST /api/auth/dev': async (req, res) => {
    if (!DEV_LOGIN) return json(res, 403, { error: 'Dev sign-in is turned off.' });
    const { name } = await body(req);
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) return json(res, 400, { error: 'Enter a name to continue.' });
    const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';
    const user = upsertUser(db, { id: `dev:${slug}`, email: null, name: clean, picture: null, provider: 'dev' });
    signIn(res, user);
  },

  'POST /api/auth/logout': (req, res) => {
    deleteSession(db, sessionToken(req));
    json(res, 200, { ok: true }, { 'Set-Cookie': clearedCookie() });
  },

  // Ends every session of this user, on every device (e.g. after a lost phone or a leaked cookie).
  'POST /api/auth/logout-all': (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'You are not signed in.' });
    const ended = deleteUserSessions(db, user.id);
    json(res, 200, { ok: true, ended }, { 'Set-Cookie': clearedCookie() });
  },

  'PUT /api/settings': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to save your settings.' });
    const changes = await body(req);
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return json(res, 400, { error: 'Send the settings as a JSON object.' });
    json(res, 200, { settings: saveSettings(db, user.id, changes) });
  },

  'GET /api/account/export': (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to download your data.' });
    const date = new Date().toISOString().slice(0, 10);
    send(res, 200, JSON.stringify(exportUser(db, user.id), null, 2), {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="smarts-data-${date}.json"`,
      'Cache-Control': 'no-store',
    });
  },

  'POST /api/reports': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to report a question.' });
    const { questionId, reason, note } = await body(req);
    if (!QUESTION_BY_ID.has(questionId)) return json(res, 400, { error: 'Unknown question.' });
    if (!REPORT_REASONS.some((r) => r.id === reason)) return json(res, 400, { error: 'Pick what is wrong with the question.' });
    const cleanNote = typeof note === 'string' ? note.trim().slice(0, REPORT_NOTE_MAX) || null : null;
    saveReport(db, user.id, { questionId, reason, note: cleanNote });
    json(res, 200, { ok: true });
  },

  'GET /api/admin/reports': (req, res, url) => {
    const user = currentUser(req);
    if (!isAdmin(user)) return json(res, user ? 403 : 401, { error: 'Only admins can see reports.' });
    const status = url.searchParams.get('status') || 'open';
    if (!REPORT_STATUSES.includes(status)) return json(res, 400, { error: `Status must be one of: ${REPORT_STATUSES.join(', ')}.` });
    json(res, 200, { reports: listReports(db, status) });
  },

  'POST /api/admin/reports/resolve': async (req, res) => {
    const user = currentUser(req);
    if (!isAdmin(user)) return json(res, user ? 403 : 401, { error: 'Only admins can resolve reports.' });
    const { questionId, status } = await body(req);
    if (typeof questionId !== 'string' || !questionId) return json(res, 400, { error: 'Missing questionId.' });
    if (status !== 'fixed' && status !== 'dismissed') return json(res, 400, { error: 'Status must be fixed or dismissed.' });
    json(res, 200, { resolved: resolveReports(db, questionId, status) });
  },

  // Deletes the account and everything stored about it. The session cookie is SameSite=Lax,
  // so another site can't send this request with the player's cookie.
  'DELETE /api/account': (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'You are not signed in.' });
    deleteUser(db, user.id);
    json(res, 200, { ok: true }, { 'Set-Cookie': clearedCookie() });
  },

  'POST /api/rounds': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to save your progress.' });
    const { mode = 'classic', category = 'mixed', answers, partial = false } = await body(req);
    const modeCfg = MODES[mode];
    if (!modeCfg) return json(res, 400, { error: `Unknown mode "${mode}".` });
    if (category !== 'mixed' && category !== 'review' && !CATEGORY_BY_ID[category]) return json(res, 400, { error: `Unknown category "${category}".` });
    if (!Array.isArray(answers) || !answers.length) return json(res, 400, { error: 'A round needs between 1 and 50 answers.' });
    const graded = grade(answers, { modeCfg });
    const result = saveRound(db, user.id, { mode, category, graded, complete: partial !== true });
    if (partial !== true) {
      logEvent(db, user.id, 'round_finished', { mode, category, correct: result.correct, total: result.total, score: result.score });
    }
    json(res, 200, { ...result, graded: graded.map(({ id, correct, points }) => ({ id, correct, points })) });
  },

  // Events the browser reports (see EVENTS in shared/config.js). Signed-out visitors aren't counted.
  'POST /api/events': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in first.' });
    const { name, props = null } = await body(req, 4096);
    if (!EVENTS[name]?.client) return json(res, 400, { error: 'Unknown event.' });
    const clean = cleanProps(props);
    if (clean === undefined) return json(res, 400, { error: 'props must be a flat object of up to 10 short values.' });
    logEvent(db, user.id, name, clean);
    json(res, 200, { ok: true });
  },

  'GET /api/admin/retention': (req, res, url) => {
    const user = currentUser(req);
    if (!isAdmin(user)) return json(res, user ? 403 : 401, { error: 'Only admins can see player numbers.' });
    const tz = Math.max(-840, Math.min(720, Math.round(Number(url.searchParams.get('tz')) || 0)));
    json(res, 200, getRetention(db, { tzOffsetMin: tz, eventNames: Object.keys(EVENTS) }));
  },

  'GET /api/stats': (req, res, url) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to see your progress.' });
    const tz = tzParam(url);
    setTimezone(db, user.id, tz);
    json(res, 200, getStats(db, user.id, { tzOffsetMin: tz }));
  },

  // ── Profile and friends ──

  'PUT /api/profile': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to change your profile.' });
    const changes = await body(req);
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return json(res, 400, { error: 'Send the profile as a JSON object.' });
    ensureProfile(db, user);
    json(res, 200, { profile: saveProfile(db, user.id, changes) });
  },

  'GET /api/friends': (req, res, url) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to see your friends.' });
    const tz = tzParam(url);
    setTimezone(db, user.id, tz);
    json(res, 200, {
      code: ensureProfile(db, user).code,
      friends: listFriends(db, user.id, localDate(tz)),
      duels: listDuels(db, user.id).map((d) => duelView(d, user.id, { brief: true })),
    });
  },

  'POST /api/friends': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to add friends.' });
    const { code } = await body(req);
    const friend = profileByCode(db, code);
    if (!friend) return json(res, 404, { error: 'No player has that code. Check it and try again.' });
    ensureProfile(db, user);
    const added = addFriend(db, user.id, friend.id);
    json(res, 200, { added, friend: shownProfile(friend) });
  },

  // ── Daily Challenge ──

  'GET /api/daily': (req, res, url) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play the Daily.' });
    const date = dailyDate(url.searchParams.get('date'));
    const daily = dailyFor(date);
    const result = dailyResult(db, date, user.id);
    if (result?.finished) result.answers = roundAnswers(db, result.roundId);
    json(res, 200, { ...daily, result });
  },

  'POST /api/daily/start': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play the Daily.' });
    const date = dailyDate((await body(req)).date);
    dailyFor(date);
    ensureProfile(db, user);
    const started = startDaily(db, date, user.id);
    json(res, 200, { started, result: dailyResult(db, date, user.id) });
  },

  'POST /api/daily/finish': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play the Daily.' });
    const { date: rawDate, answers = [], partial = false } = await body(req);
    const date = dailyDate(rawDate);
    const daily = dailyFor(date);
    const before = dailyResult(db, date, user.id);
    if (!before) return json(res, 409, { error: "Start today's Daily first." });
    if (before.finished) return json(res, 409, { error: "You've already played today's Daily.", result: before });
    const graded = grade(answers, { allowed: new Set(daily.questionIds), allowEmpty: true });
    const saved = saveFixedRound(user.id, 'daily', graded, partial === true);
    finishDaily(db, date, user.id, { ...saved, total: daily.questionIds.length });
    const result = dailyResult(db, date, user.id);
    json(res, 200, { result, board: dailyBoard(db, date, user.id, 10) });
    // Friends who already played and scored less hear about it (if they asked to).
    const me = getProfile(db, user.id);
    for (const f of friendsBeaten(db, date, user.id, result.score)) {
      reminders.friendBeatYou(f.user_id, 'beat-daily', `${date}:${user.id}`, { name: me.name, their: result.score, yours: f.score });
    }
  },

  'GET /api/daily/board': (req, res, url) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to see the board.' });
    const date = dailyDate(url.searchParams.get('date'));
    json(res, 200, { ...dailyFor(date), board: dailyBoard(db, date, user.id) });
  },

  // ── Duels ──

  'GET /api/duels': (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to see your duels.' });
    json(res, 200, { duels: listDuels(db, user.id).map((d) => duelView(d, user.id, { brief: true })) });
  },

  'POST /api/duels': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to start a duel.' });
    const { category = 'mixed', friendId = null } = await body(req);
    if (category !== 'mixed' && !CATEGORY_BY_ID[category]) return json(res, 400, { error: `Unknown category "${category}".` });
    if (friendId !== null && !areFriends(db, user.id, friendId)) return json(res, 400, { error: 'You can only send a duel to a friend.' });
    if (openDuelCount(db, user.id) >= DUEL.maxOpen) return json(res, 409, { error: `You have ${DUEL.maxOpen} duels waiting. Finish some first.` });
    ensureProfile(db, user);
    const duel = createDuel(db, {
      id: randomCode(8), challengerId: user.id, invitedId: friendId, category,
      questionIds: pickQuestions({ count: DUEL.questions, category }),
    });
    json(res, 200, { duel: duelView(duel, user.id) });
  },

  'POST /api/push/subscribe': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to get reminders.' });
    const { endpoint, keys } = await body(req);
    const okUrl = typeof endpoint === 'string' && endpoint.length < 1000 && /^https:\/\//.test(endpoint);
    if (!okUrl || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) {
      return json(res, 400, { error: 'That push subscription looks wrong.' });
    }
    savePushSubscription(db, user.id, { endpoint, p256dh: keys.p256dh, auth: keys.auth });
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in first.' });
    const { endpoint } = await body(req);
    if (typeof endpoint === 'string') deletePushSubscription(db, endpoint, user.id);
    json(res, 200, { ok: true });
  },
};

// Routes with a value in the path: [method, pattern, handler(req, res, url, ...matches), rate limit].
const DUEL_PATH = '([A-Z2-9]{8})';
const paramRoutes = [
  ['DELETE', /^\/api\/friends\/([^/]{1,100})$/, (req, res, url, friendId) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in first.' });
    removeFriend(db, user.id, decodeURIComponent(friendId));
    json(res, 200, { ok: true });
  }],

  // Who sent an invite link, for the sign-in screen (no sign-in needed).
  ['GET', /^\/api\/invite\/([A-Za-z2-9]{6})$/, (req, res, url, code) => {
    const p = profileByCode(db, code);
    if (!p) return json(res, 404, { error: 'This invite link is no longer valid.' });
    json(res, 200, { inviter: shownProfile(p) });
  }],

  ['GET', new RegExp(`^/api/duels/${DUEL_PATH}$`), (req, res, url, id) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to see this duel.' });
    const duel = getDuel(db, id);
    if (!duel) return json(res, 404, { error: 'This duel link is no longer valid.' });
    json(res, 200, { duel: duelView(duel, user.id) });
  }],

  // Who sent a duel link, for the sign-in screen (no sign-in needed).
  ['GET', new RegExp(`^/api/duels/${DUEL_PATH}/preview$`), (req, res, url, id) => {
    const duel = getDuel(db, id);
    if (!duel) return json(res, 404, { error: 'This duel link is no longer valid.' });
    const challenger = getProfile(db, duel.challengerId);
    json(res, 200, { challenger: challenger && shownProfile(challenger), score: duel.challenger.score, category: duel.category, taken: !!duel.opponentId });
  }],

  ['POST', new RegExp(`^/api/duels/${DUEL_PATH}/start$`), (req, res, url, id) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play this duel.' });
    let duel = getDuel(db, id);
    if (!duel) return json(res, 404, { error: 'This duel link is no longer valid.' });
    const role = duel.challengerId === user.id ? 'challenger' : duel.opponentId === user.id ? 'opponent' : null;
    if (!role) {
      ensureProfile(db, user);
      duel = claimDuel(db, id, user.id);
      if (!duel) return json(res, 409, { error: 'Someone else has already taken this duel.', taken: true });
      // Playing someone's duel makes you friends, so you can challenge each other again.
      try { addFriend(db, user.id, duel.challengerId); } catch { /* at the friend limit: play anyway */ }
    } else if (duel[role].score !== null) {
      return json(res, 409, { error: "You've already played this duel.", duel: duelView(duel, user.id) });
    }
    json(res, 200, { duel: duelView(duel, user.id) });
  }, 'duels'],

  ['POST', new RegExp(`^/api/duels/${DUEL_PATH}/finish$`), async (req, res, url, id) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play this duel.' });
    const { answers = [], partial = false } = await body(req);
    const duel = getDuel(db, id);
    if (!duel) return json(res, 404, { error: 'This duel link is no longer valid.' });
    const role = duel.challengerId === user.id ? 'challenger' : duel.opponentId === user.id ? 'opponent' : null;
    if (!role) return json(res, 403, { error: "You're not in this duel." });
    if (duel[role].score !== null) return json(res, 409, { error: "You've already played this duel." });
    const graded = grade(answers, { allowed: new Set(duel.questionIds), allowEmpty: true });
    finishDuelSide(db, id, role, saveFixedRound(user.id, 'duel', graded, partial === true));
    const done = getDuel(db, id);
    json(res, 200, { duel: duelView(done, user.id) });
    // The other player hears about it if they lost (and asked to be told).
    const other = role === 'challenger' ? 'opponent' : 'challenger';
    const otherId = role === 'challenger' ? done.opponentId : done.challengerId;
    if (done.finishedAt && otherId && duelWinner(done) === role) {
      reminders.friendBeatYou(otherId, 'beat-duel', id, {
        name: getProfile(db, user.id).name, their: done[role].score, yours: done[other].score, duelId: id,
      });
    }
  }, 'duels'],

  ['POST', new RegExp(`^/api/duels/${DUEL_PATH}/rematch$`), (req, res, url, id) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in first.' });
    const duel = getDuel(db, id);
    if (!duel) return json(res, 404, { error: 'This duel link is no longer valid.' });
    const otherId = duel.challengerId === user.id ? duel.opponentId : duel.opponentId === user.id ? duel.challengerId : null;
    if (!otherId) return json(res, 409, { error: 'There is nobody to play a rematch with.' });
    if (openDuelCount(db, user.id) >= DUEL.maxOpen) return json(res, 409, { error: `You have ${DUEL.maxOpen} duels waiting. Finish some first.` });
    const rematch = createDuel(db, {
      id: randomCode(8), challengerId: user.id, invitedId: otherId, category: duel.category, rematchOf: id,
      questionIds: pickQuestions({ count: DUEL.questions, category: duel.category }),
    });
    json(res, 200, { duel: duelView(rematch, user.id) });
  }, 'duelCreate'],
];

function matchParamRoute(method, pathname) {
  for (const [m, pattern, handler, limit] of paramRoutes) {
    if (m !== method) continue;
    const match = pattern.exec(pathname);
    if (match) return { handler, args: match.slice(1), limit, name: `${m} ${pattern.source}` };
  }
  return null;
}

// ── Game helpers ───────────────────────────────────────────────

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

// Time zones run from UTC-12 to UTC+14; anything else is nonsense.
const tzParam = (url) => Math.max(-840, Math.min(720, Math.round(Number(url.searchParams.get('tz')) || 0)));

/**
 * Grades answers on the server, from shared/questions.js, so the browser can't post a fake
 * score. `allowed` limits them to one round's questions (the Daily, a duel).
 */
function grade(answers, { modeCfg = MODES[DEFAULT_MODE], allowed = null, allowEmpty = false } = {}) {
  if (!Array.isArray(answers) || answers.length > 50 || (!allowEmpty && !answers.length)) throw badRequest('A round needs between 1 and 50 answers.');
  const graded = [];
  const seen = new Set();
  for (const a of answers) {
    const q = QUESTION_BY_ID.get(a?.id);
    if (!q) throw badRequest(`Unknown question "${a?.id}".`);
    if (allowed && !allowed.has(q.id)) throw badRequest(`Question "${q.id}" isn't in this round.`);
    if (seen.has(q.id)) throw badRequest(`Question "${q.id}" appears twice in one round.`);
    seen.add(q.id);
    const seconds = secondsFor(q, modeCfg); // some topics (the books) allow more time
    const limitMs = seconds * 1000;
    const rawMs = Number(a.ms);
    const validMs = Number.isFinite(rawMs) && rawMs >= 0;
    const ms = validMs ? Math.min(limitMs, Math.round(rawMs)) : limitMs;
    const choice = typeof a.choice === 'string' ? a.choice.slice(0, 200) : null;
    const inTime = validMs && rawMs <= limitMs + 1000; // small allowance for render jitter
    const correct = inTime && choice === q.answer;
    graded.push({ id: q.id, cat: q.cat, choice, correct, ms, points: pointsFor(correct, ms, seconds) });
  }
  return graded;
}

/** Saves a Daily or duel round like any other (it counts in stats). Returns its score and time. */
function saveFixedRound(userId, category, graded, partial) {
  if (!graded.length) return { roundId: null, score: 0, correct: 0, ms: 0 };
  const r = saveRound(db, userId, { mode: DEFAULT_MODE, category, graded, complete: !partial });
  if (!partial) logEvent(db, userId, 'round_finished', { mode: DEFAULT_MODE, category, correct: r.correct, total: r.total, score: r.score });
  return { roundId: r.roundId, score: r.score, correct: r.correct, ms: graded.reduce((sum, a) => sum + a.ms, 0) };
}

/**
 * A Daily date as the player's own calendar date. Time zones run from UTC-12 to UTC+14, so it's
 * within a day of the server's UTC date; anything else is refused.
 */
function dailyDate(value) {
  const today = localDate(0);
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
  if (Math.abs(Date.parse(date) - Date.parse(today)) > 86_400_000 || date < DAILY.start) throw badRequest('That Daily is not available.');
  return date;
}

const dailyFor = (date) => getDaily(db, date, dailyNumber(date), (recent) => pickQuestions({ count: DAILY.questions, seed: `daily:${date}`, avoid: recent }));

/** 'challenger', 'opponent' or 'draw' once both have played: more points wins, then less time. */
function duelWinner(d) {
  const a = d.challenger;
  const b = d.opponent;
  if (a.score === null || b.score === null) return null;
  if (a.score !== b.score) return a.score > b.score ? 'challenger' : 'opponent';
  if (a.ms !== b.ms) return a.ms < b.ms ? 'challenger' : 'opponent';
  return 'draw';
}

/**
 * A duel as one player sees it. Everyone sees the scores; the answers are shown once the
 * viewer has played their own side (theirs) and once both have (both).
 */
function duelView(d, viewerId, { brief = false } = {}) {
  const role = d.challengerId === viewerId ? 'challenger' : d.opponentId === viewerId ? 'opponent' : null;
  const person = (id, side) => {
    const p = id && getProfile(db, id);
    return { ...(p ? shownProfile(p) : { id: null, name: null, avatar: null, country: null, gone: side.score !== null }), score: side.score, correct: side.correct, ms: side.ms };
  };
  const mine = role && d[role].score !== null;
  const status = d.finishedAt ? 'done'
    : !role ? (d.opponentId ? 'taken' : d.invitedId === viewerId ? 'invited' : 'open')
      : mine ? 'waiting' : 'yourTurn';
  const view = {
    id: d.id, category: d.category, role, status, winner: duelWinner(d), invited: d.invitedId === viewerId,
    challenger: person(d.challengerId, d.challenger),
    opponent: d.opponentId || d.opponent.score !== null ? person(d.opponentId, d.opponent) : null,
    invitedFriend: !d.opponentId && d.invitedId ? shownProfile(getProfile(db, d.invitedId) ?? { id: d.invitedId, name: null }) : null,
    createdAt: d.createdAt, finishedAt: d.finishedAt,
  };
  if (brief) return view;
  view.questionIds = d.questionIds;
  if (mine) view.answers = { [role]: roundAnswers(db, d[role].roundId) };
  if (d.finishedAt && role) {
    view.answers.challenger = roundAnswers(db, d.challenger.roundId);
    view.answers.opponent = roundAnswers(db, d.opponent.roundId);
  }
  return view;
}

/** Event props: null, or a flat object of up to 10 strings (≤100 chars), numbers or booleans. Else undefined. */
function cleanProps(props) {
  if (props === null) return null;
  if (typeof props !== 'object' || Array.isArray(props)) return undefined;
  const entries = Object.entries(props);
  if (entries.length > 10) return undefined;
  const ok = entries.every(([k, v]) =>
    k.length <= 40 && (typeof v === 'boolean' || Number.isFinite(v) || (typeof v === 'string' && v.length <= 100)));
  return ok ? Object.fromEntries(entries) : undefined;
}

// ── Rate limits and capacity ───────────────────────────────────
// Sized for up to 100 players at once, some of them sharing one address (a school or
// office Wi-Fi). A normal player makes a few API requests a minute and loads a couple of
// pictures per question.

const MINUTE = 60_000;
const LIMITS = {
  perAddress: rateLimiter({ limit: 300, windowMs: MINUTE }), // every API request from one IP
  perClient: rateLimiter({ limit: 60, windowMs: MINUTE }), // every API request from one browser
  signIn: rateLimiter({ limit: 30, windowMs: 10 * MINUTE }), // sign-in attempts from one IP
  rounds: rateLimiter({ limit: 15, windowMs: 10 * MINUTE }), // saved rounds per browser (a real round takes a while)
  export: rateLimiter({ limit: 3, windowMs: 60 * MINUTE }), // data downloads per browser
  reports: rateLimiter({ limit: 10, windowMs: 10 * MINUTE }), // question reports per browser
  events: rateLimiter({ limit: 60, windowMs: 10 * MINUTE }), // logged events per browser
  social: rateLimiter({ limit: 30, windowMs: 10 * MINUTE }), // friend adds, profile saves, push sign-ups
  daily: rateLimiter({ limit: 20, windowMs: 10 * MINUTE }), // Daily starts and finishes
  duels: rateLimiter({ limit: 40, windowMs: 10 * MINUTE }), // duel starts and finishes
  duelCreate: rateLimiter({ limit: 30, windowMs: 60 * MINUTE }), // new duels and rematches
  static: rateLimiter({ limit: 600, windowMs: MINUTE }), // pages, scripts and pictures from one IP
};

const capacity = capacityGate({ max: MAX_PLAYERS, idleMs: PLAYER_IDLE_MS });

const FULL_MESSAGE = `Smarts is full right now (${MAX_PLAYERS} players). Try again in a few minutes.`;
const FULL_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="60">
<title>Smarts is full</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#2A3BD1;color:#fff;font:18px/1.5 system-ui,sans-serif;text-align:center;padding:24px">
<div><h1 style="margin:0 0 8px;font-size:32px">Smarts is full right now</h1>
<p style="margin:0 0 28px">${MAX_PLAYERS} people are already playing. This page tries again every minute.</p>
<h2 dir="rtl" lang="he" style="margin:0 0 6px;font-size:24px">המשחק מלא כרגע</h2>
<p dir="rtl" lang="he" style="margin:0 0 28px">${MAX_PLAYERS} אנשים כבר משחקים. הדף ינסה שוב בכל דקה.</p>
<h2 dir="rtl" lang="ar" style="margin:0 0 6px;font-size:24px">اللعبة ممتلئة الآن</h2>
<p dir="rtl" lang="ar" style="margin:0">${MAX_PLAYERS} شخصًا يلعبون الآن. ستحاول هذه الصفحة مرة أخرى كل دقيقة.</p></div></body></html>`;

const ROUTE_LIMITS = {
  'POST /api/auth/google': 'signIn',
  'POST /api/auth/dev': 'signIn',
  'POST /api/rounds': 'rounds',
  'GET /api/account/export': 'export',
  'POST /api/reports': 'reports',
  'POST /api/events': 'events',
  'PUT /api/profile': 'social',
  'POST /api/friends': 'social',
  'POST /api/push/subscribe': 'social',
  'POST /api/daily/start': 'daily',
  'POST /api/daily/finish': 'daily',
  'POST /api/duels': 'duelCreate',
};

let warnedAboutProxy = false;

/** Counts this API request. Returns the seconds to wait if it is over a limit, else 0. */
function overLimit(req, route, routeLimit = ROUTE_LIMITS[route]) {
  if (!TRUST_PROXY && req.headers['x-forwarded-for'] && !warnedAboutProxy) {
    warnedAboutProxy = true;
    console.warn('  Requests arrive through a proxy, but TRUST_PROXY is not set: all players share one rate limit. Set TRUST_PROXY=1.');
  }
  const ip = clientIp(req, TRUST_PROXY);
  const client = sessionToken(req) || ip; // signed-in players are counted per session, others per address
  const checks = [LIMITS.perAddress(ip), LIMITS.perClient(client)];
  if (routeLimit) checks.push(LIMITS[routeLimit](routeLimit === 'signIn' ? ip : client));
  const blocked = checks.filter((c) => !c.ok);
  return blocked.length ? Math.max(...blocked.map((c) => c.retryAfter)) : 0;
}

// ── Static files ───────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.md': 'text/plain; charset=utf-8',
};

// Text files are sent gzipped to browsers that accept it (most of them): app.js and the
// question bank shrink to a fraction of their size. Compressed copies are kept in memory.
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.webmanifest']);
const gzipCache = new Map(); // file -> { etag, data }

// Question pictures and road signs rarely change, so browsers may keep them for a day (a
// replaced picture shows up by the next day). Everything else is checked with the server on
// each load (cheap: an unchanged file is answered with "304 Not Modified" and no body).
const LONG_CACHE = /^\/(img|signs)\//;

async function sendFile(req, res, file, pathname) {
  const info = await stat(file);
  if (!info.isFile()) return false;
  const ext = extname(file).toLowerCase();
  const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': LONG_CACHE.test(pathname) ? 'public, max-age=86400' : 'no-cache',
    ETag: etag,
    'Last-Modified': info.mtime.toUTCString(),
  };
  if (req.headers['if-none-match'] === etag) {
    send(res, 304, undefined, headers);
    return true;
  }
  let data = await readFile(file);
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    let cached = gzipCache.get(file);
    if (cached?.etag !== etag) {
      cached = { etag, data: gzipSync(data) };
      gzipCache.set(file, cached);
    }
    data = cached.data;
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  send(res, 200, data, headers);
  return true;
}

let shellCache = null; // { mtime, html }

async function sendAppShell(req, res, pathname) {
  const file = join(ROOT, 'public', 'index.html');
  const { mtimeMs } = await stat(file);
  if (shellCache?.mtime !== mtimeMs) shellCache = { mtime: mtimeMs, html: await readFile(file, 'utf8') };
  const url = new URL(req.url, 'http://localhost');
  const meta = shareMeta(db, pathname, url.searchParams.get('l'), req.headers['accept-language']);
  const origin = siteOrigin(req);
  const abs = (path) => `${origin}${path}`;
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Smarts">`,
    `<meta property="og:title" content="${escAttr(meta.title)}">`,
    `<meta property="og:description" content="${escAttr(meta.description)}">`,
    `<meta property="og:url" content="${escAttr(abs(pathname))}">`,
    `<meta property="og:image" content="${escAttr(abs('/og.jpg'))}">`,
    `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="Smarts, the picture quiz">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join('\n  ');
  const html = shellCache.html.replace('<!--share-->', tags);
  let data = Buffer.from(html);
  const headers = { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' };
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    data = gzipSync(data);
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  send(res, 200, req.method === 'HEAD' ? undefined : data, headers);
}

const escAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The site's address for links in previews: PUBLIC_URL, else the address this request came to. */
function siteOrigin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()) || (SECURE_COOKIES ? 'https' : 'http');
  return `${proto}://${req.headers.host}`;
}

const STATIC_ROOTS = [
  ['/shared/', join(ROOT, 'shared')],
  ['/', join(ROOT, 'public')],
];

async function serveStatic(req, res, pathname) {
  for (const [prefix, dir] of STATIC_ROOTS) {
    if (!pathname.startsWith(prefix)) continue;
    let rel;
    try {
      rel = normalize(decodeURIComponent(pathname.slice(prefix.length))).replace(/^([/\\])+/, '');
    } catch {
      return send(res, 400, 'Bad path');
    }
    const file = join(dir, rel);
    // Must stay inside `dir` (a bare startsWith(dir) would also allow a sibling like "public-old").
    if (file !== dir && !file.startsWith(dir + sep)) return send(res, 403, 'Forbidden');
    try {
      if (await sendFile(req, res, file, pathname)) return;
    } catch { /* fall through */ }
    if (prefix === '/shared/') return send(res, 404, 'Not found');
  }
  // Privacy policy, terms of use and photo credits, in the language asked for (see server/pages.js).
  // The privacy and terms addresses are also linked from Google's sign-in screen.
  const legal = await legalPage(req, pathname);
  if (legal) return send(res, 200, legal.html, legal.headers);
  // Single-page app: unknown non-file paths get the app shell, with a link preview (for
  // WhatsApp, Telegram and the like) that fits the address: a duel, an invite or the Daily.
  if (!extname(pathname)) return sendAppShell(req, res, pathname);
  send(res, 404, 'Not found');
}

// ── Server ─────────────────────────────────────────────────────

/** True if a browser request that changes something comes from another website. */
function crossSite(req) {
  const origin = req.headers.origin;
  if (!origin) return false; // not sent by a browser (or a same-origin GET)
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

const server = createServer(async (req, res) => {
  try {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const isApi = url.pathname.startsWith('/api/');
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /api/health') return routes[route](req, res, url);

    // Over capacity: players already in carry on, new ones are asked to come back later.
    if (!capacity.admit(sessionToken(req), clientIp(req, TRUST_PROXY))) {
      const headers = { 'Retry-After': '120' };
      if (isApi) return json(res, 503, { error: FULL_MESSAGE }, headers);
      if (!extname(url.pathname)) return send(res, 503, FULL_PAGE, { ...headers, 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      return send(res, 503, FULL_MESSAGE, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    }

    if (isApi) {
      const param = routes[route] ? null : matchParamRoute(req.method, url.pathname);
      const wait = overLimit(req, route, param ? param.limit : ROUTE_LIMITS[route]);
      if (wait) {
        return json(res, 429, { error: `Too many requests. Wait ${wait} seconds and try again.` }, { 'Retry-After': String(wait) });
      }
      // Session cookies are SameSite=Lax already; this also stops other sites' scripts outright.
      if (req.method !== 'GET' && crossSite(req)) return json(res, 403, { error: 'Requests from other websites are not allowed.' });
      if (param) return await param.handler(req, res, url, ...param.args);
      const handler = routes[route];
      if (!handler) return json(res, 404, { error: 'No such endpoint.' });
      return await handler(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    const staticWait = LIMITS.static(clientIp(req, TRUST_PROXY));
    if (!staticWait.ok) return send(res, 429, 'Too many requests', { 'Retry-After': String(staticWait.retryAfter), 'Content-Type': 'text/plain; charset=utf-8' });
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    if (!err.status) console.error(err); // errors with a status are the client's mistake, already explained in the reply
    if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong on the server.' });
  }
});

// Slow or stuck clients can't hold connections open for long.
server.headersTimeout = 15_000; // the request line and headers must arrive within 15 s
server.requestTimeout = 30_000; // and the whole request within 30 s
server.maxConnections = 1000; // ~100 players with several browser connections each, plus headroom

server.listen(PORT, HOST, () => {
  console.log(`\n  Smarts is running at http://localhost:${PORT}${PRODUCTION ? ' (production)' : ''}`);
  console.log(`  Google sign-in: ${GOOGLE_CLIENT_ID ? 'on' : 'off (set GOOGLE_CLIENT_ID in .env)'}`);
  console.log(`  Dev sign-in:    ${DEV_LOGIN ? 'on' : 'off'}`);
  console.log(`  Players:        up to ${MAX_PLAYERS} at once`);
  console.log(`  Database:       ${DB_FILE}\n`);
});

// Close the database cleanly on shutdown so the WAL file is folded back into smarts.db.
// node:sqlite calls are synchronous, so no query can be half-done when this runs.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    optimizeDb(db);
    db.close();
    process.exit(0);
  });
}
