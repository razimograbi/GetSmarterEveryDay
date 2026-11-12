import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';

import {
  openDb, optimizeDb, upsertUser, deleteUser, saveRound, getStats, exportUser, finishedRounds,
  createSession, sessionUser, deleteSession, deleteUserSessions, purgeExpiredSessions,
  getSettings, saveSettings, saveReport, listReports, resolveReports, REPORT_STATUSES, logEvent, getRetention,
  buyItem, duelCoinsEarned, duelWinner, ownProfile, ensureProfile, getProfile, saveProfile, setTimezone, profileByCode, shownProfile, randomCode, getMarketingProject, saveMarketingProject, playerCount,
  addFriend, removeFriend, areFriends, listFriends,
  getDaily, dailyResult, startDaily, finishDaily, dailyBoard, friendsBeaten, purgeOldPlays,
  listStages, stageForAdmin, createStage, updateStage, moveStage, deleteStage, addStageQuestion, updateStageQuestion, moveStageQuestion, deleteStageQuestion,
  stagePath, stageRound, openStagePlay, finishStageTry,
  questResults, friendsFirstTry, openQuestPlay, finishQuestTry,
  createDuel, getDuel, finishDuelSide, markDuelResultSeen, listDuels, openDuelCount, openRematch, recentQuestionIds, roundAnswers,
  savePushSubscription, deletePushSubscription,
} from './db.js';
import {
  verifyGoogleIdToken, sessionCookie, clearedCookie, parseCookies, SESSION_COOKIE, SESSION_TTL_MS,
} from './auth.js';
import { rateLimiter, clientIp, capacityGate } from './ratelimit.js';
import { QUESTIONS, QUESTION_BY_ID } from '../shared/questions.js';
import {
  MODES, DEFAULT_MODE, CATEGORIES, CATEGORY_BY_ID, REPORT_REASONS, REPORT_NOTE_MAX, EVENTS, DAILY, DUEL, QUEST, STAGE_PICTURE_HOSTS, pointsFor, secondsFor, localDate, dailyNumber, questPrize,
} from '../shared/config.js';
import { legalPage, shareMeta } from './pages.js';
import { hasEnoughQuestions, pickQuestions } from './pick.js';
import { BROWSER_BANK, contentFor } from './bank.js';
import { createPlays } from './play.js';
import { QUESTS, QUEST_BY_ID, questQuestions } from './quests.js';
import { createMatches } from './match.js';
import { loadVapidKeys, createReminders } from './push.js';

const ROOT = resolve(import.meta.dirname, '..');
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
  purgeOldPlays(db);
  optimizeDb(db);
}, 3_600_000).unref();

// Push reminders. The key pair is made once and kept in the data folder (or set VAPID_PUBLIC_KEY
// and VAPID_PRIVATE_KEY). Push services may use VAPID_SUBJECT to contact whoever runs the server.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@localhost';
if (PRODUCTION && !process.env.VAPID_SUBJECT) console.warn('  VAPID_SUBJECT is not set: push services want a contact, such as mailto:you@example.com.');
const reminders = createReminders({ db, keys: loadVapidKeys(join(DATA_DIR, 'vapid.json')), subject: VAPID_SUBJECT });
reminders.start();

const plays = createPlays(db, { onFinish: finishFixedRound, endsOnMiss: (play) => play.kind === 'quest' }); // a level ends at its first wrong answer
setInterval(() => plays.endStale(), 60_000).unref();

// Live duels (server/match.js). Questions are picked when one starts, when both players are known.
const matches = createMatches(db, {
  plays, reminders,
  profileOf: (id) => shownProfile(getProfile(db, id)),
  pick: (a, b, category, avoid) => pickQuestions({ count: DUEL.questions, category, avoid, seenRecently: seenByPlayers(a, b) }),
});

// ── HTTP helpers ───────────────────────────────────────────────

const CSP = [
  "default-src 'self'",
  "media-src 'self' blob:", // the Marketing Studio plays back its recordings
  "script-src 'self' https://accounts.google.com/gsi/client",
  "frame-src https://accounts.google.com/gsi/",
  "connect-src 'self' https://accounts.google.com/gsi/ https://en.wikipedia.org https://cdn.jsdelivr.net https://unpkg.com",
  `img-src 'self' data: blob: ${STAGE_PICTURE_HOSTS.map((host) => `https://${host}`).join(' ')} https://server.arcgisonline.com https://*.googleusercontent.com`,
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
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) ?? {}; // a body of "null" says nothing, like an empty one
  } catch {
    throw Object.assign(new Error('Request body must be JSON'), { status: 400 });
  }
}

const sessionToken = (req) => parseCookies(req.headers.cookie)[SESSION_COOKIE];

function currentUser(req) {
  return sessionUser(db, sessionToken(req));
}

const isAdmin = (u) => !!u && (ADMINS.has(u.id.toLowerCase()) || (!!u.email && ADMINS.has(u.email.toLowerCase())));

// Who can open the Marketing Studio: comma-separated Google emails (or user ids such as dev:razi).
const MARKETERS = new Set((process.env.MARKETING_USERS || 'razimograbi44@gmail.com').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const isMarketer = (u) => !!u && (MARKETERS.has(u.id.toLowerCase()) || (!!u.email && MARKETERS.has(u.email.toLowerCase())));
const MARKETING_PROJECT_MAX = 256 * 1024; // the built-in videos plus the team's own, words and post text

/** The Marketing Studio's routes refuse everyone else. Returns true once it has replied. */
function refuseNonMarketer(res, user) {
  if (isMarketer(user)) return false;
  json(res, user ? 403 : 401, { error: 'Only the marketing team can open this.' });
  return true;
}

/** A route for admins only. `act(input, ...ids)` returns the reply; errors it throws say what to fix. */
function adminRoute(act) {
  return async (req, res, url, ...ids) => {
    const user = currentUser(req);
    if (!isAdmin(user)) return json(res, user ? 403 : 401, { error: 'Only admins can change Leveling.' });
    const input = req.method === 'GET' || req.method === 'DELETE' ? {} : await body(req, 16 * 1024);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json(res, 400, { error: 'Send a JSON object.' });
    json(res, 200, act(input, ...ids.map(Number)));
  };
}

const publicUser = (u) => u && {
  id: u.id, name: u.name, email: u.email, picture: u.picture, provider: u.provider, since: u.created_at, admin: isAdmin(u), marketing: isMarketer(u),
};

/**
 * Starts a new session for `user` and replies with the user and their settings. `locale` is
 * the language of their Google account when Google shares it, used only as a hint.
 */
function signIn(res, user, locale = null) {
  const token = createSession(db, user.id, SESSION_TTL_MS);
  json(res, 200, {
    user: publicUser(user), settings: getSettings(db, user.id), profile: ownProfile(db, ensureProfile(db, user)), played: finishedRounds(db, user.id), locale,
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
      user: publicUser(user), settings: user ? getSettings(db, user.id) : null, profile: user ? ownProfile(db, ensureProfile(db, user)) : null,
      played: user ? finishedRounds(db, user.id) : 0, // rounds finished: 0 shows the new-player home
      liveDuel: user ? matches.liveFor(user.id) : null, // a duel going on right now, to get back to
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
    const reports = listReports(db, status);
    json(res, 200, { reports, questions: contentFor(reports.map((r) => r.questionId)) });
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
    matches.userGone(user.id);
    deleteUser(db, user.id);
    json(res, 200, { ok: true }, { 'Set-Cookie': clearedCookie() });
  },

  // Buys something the player's level has unlocked. The server checks the level and the price.
  'POST /api/shop/buy': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to buy this.' });
    const { part, value } = await body(req);
    ensureProfile(db, user);
    try {
      json(res, 200, buyItem(db, user.id, part, value));
    } catch (err) {
      if (err.code !== 'notEnoughCoins') throw err;
      json(res, err.status, { error: err.message, code: err.code });
    }
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

  // The questions of a Quick or topic round about to be played: their words, options and answers.
  // Daily and duel questions never come through here (see server/play.js).
  'POST /api/questions': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play.' });
    const { ids } = await body(req);
    if (!Array.isArray(ids) || !ids.length || ids.length > QUESTIONS_PER_REQUEST) return json(res, 400, { error: `Ask for 1 to ${QUESTIONS_PER_REQUEST} questions.` });
    json(res, 200, { questions: contentFor(ids) });
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

  // ── Marketing Studio ──

  // Everything the videos draw on. It includes right answers, so it's for the marketing team only.
  'GET /api/marketing/kit': (req, res) => {
    const user = currentUser(req);
    if (refuseNonMarketer(res, user)) return;
    const questions = Object.values(contentFor(QUESTIONS.map((q) => q.id))).map((q) => ({ ...q, difficulty: QUESTION_BY_ID.get(q.id).difficulty }));
    json(res, 200, {
      questions, project: getMarketingProject(db), siteUrl: siteOrigin(req),
      counts: { questions: QUESTIONS.length, topics: CATEGORIES.length, players: playerCount(db) },
    });
  },

  'PUT /api/marketing/project': async (req, res) => {
    const user = currentUser(req);
    if (refuseNonMarketer(res, user)) return;
    const project = await body(req, MARKETING_PROJECT_MAX);
    if (!project || typeof project !== 'object' || Array.isArray(project)) return json(res, 400, { error: 'Send the project as a JSON object.' });
    saveMarketingProject(db, project);
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
    const stats = getStats(db, user.id, { tzOffsetMin: tz });
    json(res, 200, { ...stats, questions: contentFor(stats.missed.slice(0, MISSED_SHOWN).map((m) => m.id)) });
  },

  // ── Profile and friends ──

  'PUT /api/profile': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to change your profile.' });
    const changes = await body(req);
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return json(res, 400, { error: 'Send the profile as a JSON object.' });
    ensureProfile(db, user);
    json(res, 200, { profile: ownProfile(db, saveProfile(db, user.id, changes)) });
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
    const { questionIds, ...daily } = dailyFor(date);
    const result = dailyResult(db, date, user.id);
    const out = { ...daily, count: questionIds.length, result };
    // The questions stay secret until the player has finished their try.
    if (result?.finished) {
      result.answers = roundAnswers(db, result.roundId);
      Object.assign(out, { questionIds, questions: contentFor(questionIds) });
    }
    json(res, 200, out);
  },

  // Starts the player's one try, or picks up the one they already have open.
  'POST /api/daily/start': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play the Daily.' });
    const date = dailyDate((await body(req)).date);
    const { questionIds } = dailyFor(date);
    ensureProfile(db, user);
    let play = plays.find('daily', date, user.id);
    if (!play) {
      if (!startDaily(db, date, user.id)) return json(res, 200, { started: false, result: dailyResult(db, date, user.id) });
      play = plays.begin({ kind: 'daily', ref: date, userId: user.id, questionIds });
    } else if (play.finishedAt) {
      return json(res, 200, { started: false, result: dailyResult(db, date, user.id) });
    }
    json(res, 200, { started: true, result: dailyResult(db, date, user.id), play: plays.view(play) });
  },

  // Ends the player's try where it stands: whatever they haven't answered counts as wrong.
  'POST /api/daily/finish': async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play the Daily.' });
    const date = dailyDate((await body(req)).date);
    const play = plays.find('daily', date, user.id);
    if (!play) return json(res, 409, { error: "Start today's Daily first." });
    if (!plays.finish(play)) return json(res, 409, { error: "You've already played today's Daily.", result: dailyResult(db, date, user.id) });
    json(res, 200, { result: dailyResult(db, date, user.id), board: dailyBoard(db, date, user.id, 10) });
  },

  'GET /api/daily/board': (req, res, url) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to see the board.' });
    const date = dailyDate(url.searchParams.get('date'));
    const { day, number } = dailyFor(date);
    json(res, 200, { day, number, board: dailyBoard(db, date, user.id) });
  },

  // ── Leveling ──

  // The published stages as this player stands on them: never the questions.
  'GET /api/stages': (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to see the stages.' });
    json(res, 200, { stages: stagePath(db, user.id) });
  },

  // The Levels as this player stands on them: never the questions.
  'GET /api/quests': (req, res) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to see the levels.' });
    json(res, 200, { levels: questPath(user.id) });
  },

  'GET /api/admin/stages': adminRoute(() => ({ stages: listStages(db) })),
  'POST /api/admin/stages': adminRoute((input) => ({ stage: createStage(db, input) })),

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
    if (!hasEnoughQuestions(category, DUEL.questions)) return json(res, 409, { error: 'This topic is not available for duels right now.', code: 'topicUnavailable' });
    const busy = matches.liveFor(user.id);
    if (busy) return json(res, 409, { error: 'You are already in a live duel.', live: busy });
    if (openDuelCount(db, user.id) >= DUEL.maxOpen) return json(res, 409, { error: `You have ${DUEL.maxOpen} duels waiting. Finish some first.` });
    ensureProfile(db, user);
    const duel = createDuel(db, { id: randomCode(8), challengerId: user.id, invitedId: friendId, category });
    matches.open(duel);
    if (friendId) reminders.duelSent(friendId, duel.id, { name: getProfile(db, user.id).name });
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
const PLAY_PATH = '([0-9a-f-]{36})';
const ID_PATH = '(\\d{1,9})';

/** A route for one question of a round the signed-in player owns. Duels are played through matches instead. */
function playRoute(act) {
  return async (req, res, url, id) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play.' });
    const input = await body(req, 4096);
    if (!Number.isInteger(input?.idx)) return json(res, 400, { error: 'Say which question this is.' });
    const play = plays.get(id);
    if (!play || play.userId !== user.id || play.kind === 'duel') return json(res, 404, { error: 'This round no longer exists.' });
    try {
      json(res, 200, act(play, input));
    } catch (err) {
      if (err.status !== 409) throw err;
      json(res, 409, { error: err.message, ended: !!err.ended });
    }
  };
}

/** A route of a live duel. `act(user, id, input)` returns where the match stands for this player. */
function matchRoute(act) {
  return async (req, res, url, id) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play this duel.' });
    const input = req.method === 'GET' ? {} : await body(req, 4096);
    try {
      json(res, 200, act(user, id, input));
    } catch (err) {
      if (!err.status) throw err;
      json(res, err.status, { error: err.message, ended: !!err.ended, taken: !!err.taken, live: err.live ?? null });
    }
  };
}

/** The live connection of a duel: the server tells this browser whenever the match changes. */
function matchStream(req, res, url, id) {
  const user = currentUser(req);
  if (!user) return json(res, 401, { error: 'Sign in to play this duel.' });
  if (crossSite(req)) return json(res, 403, { error: 'Requests from other websites are not allowed.' });
  try {
    matches.state(id, user.id);
  } catch (err) {
    if (!err.status) throw err;
    return json(res, err.status, { error: err.message });
  }
  res.writeHead(200, {
    ...BASE_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no', // nginx and the like must pass each message on at once
    Connection: 'keep-alive',
  });
  req.socket.setKeepAlive?.(true, 15_000);
  res.write('retry: 1500\n\n');
  res.on('close', matches.attach(id, user.id, res));
}

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
    markDuelResultSeen(db, id, user.id);
    json(res, 200, { duel: duelView(duel, user.id) });
  }],

  // Who sent a duel link, for the sign-in screen (no sign-in needed).
  ['GET', new RegExp(`^/api/duels/${DUEL_PATH}/preview$`), (req, res, url, id) => {
    const duel = getDuel(db, id);
    if (!duel) return json(res, 404, { error: 'This duel link is no longer valid.' });
    const challenger = getProfile(db, duel.challengerId);
    json(res, 200, { challenger: challenger && shownProfile(challenger), score: duel.challenger.score, category: duel.category, taken: !!duel.opponentId });
  }],

  // Takes the second seat of a duel that's waiting. Playing someone's duel makes you friends,
  // so you can challenge each other again.
  ['POST', new RegExp(`^/api/duels/${DUEL_PATH}/join$`), matchRoute((user, id) => joinDuel(user, id)), 'duels'],
  ['GET', new RegExp(`^/api/duels/${DUEL_PATH}/stream$`), matchStream, 'live'],
  ['GET', new RegExp(`^/api/duels/${DUEL_PATH}/state$`), matchRoute((user, id) => matches.state(id, user.id)), 'live'],
  ['POST', new RegExp(`^/api/duels/${DUEL_PATH}/beat$`), matchRoute((user, id) => matches.beat(id, user.id)), 'live'],
  ['POST', new RegExp(`^/api/duels/${DUEL_PATH}/away$`), matchRoute((user, id) => matches.away(id, user.id)), 'live'],
  ['POST', new RegExp(`^/api/duels/${DUEL_PATH}/ready$`), matchRoute((user, id, input) => matches.ready(id, user.id, input.idx, input.failed)), 'live'],
  ['POST', new RegExp(`^/api/duels/${DUEL_PATH}/seen$`), matchRoute((user, id, input) => matches.seen(id, user.id, input.idx)), 'live'],
  ['POST', new RegExp(`^/api/duels/${DUEL_PATH}/answer$`), matchRoute((user, id, input) => matches.answer(id, user.id, input.idx, input.choice, input.away)), 'live'],
  ['POST', new RegExp(`^/api/duels/${DUEL_PATH}/leave$`), matchRoute((user, id) => matches.leave(id, user.id)), 'live'],

  // Starts a try at a stage, or picks up the one this player has open.
  ['POST', new RegExp(`^/api/stages/${ID_PATH}/start$`), (req, res, url, rawId) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play.' });
    ensureProfile(db, user);
    const id = Number(rawId);
    const stage = stagePath(db, user.id).find((s) => s.id === id);
    if (!stage) return json(res, 404, { error: 'That stage is not available.' });
    if (stage.status === 'locked') return json(res, 403, { error: 'Clear the stage before this one first.' });
    let play = openStagePlay(db, id, user.id);
    if (!play) {
      const round = stageRound(db, id);
      if (!round) return json(res, 404, { error: 'That stage is not available.' });
      play = plays.begin({ kind: 'stage', ref: `${id}:${randomUUID()}`, userId: user.id, questionIds: round.ids, content: round.content });
    }
    json(res, 200, { stage: { id, title: stage.title }, play: plays.view(play) });
  }, 'stages'],

  // Ends the player's open try where it stands: whatever they haven't answered counts as wrong.
  ['POST', new RegExp(`^/api/stages/${ID_PATH}/finish$`), (req, res, url, rawId) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play.' });
    const play = openStagePlay(db, Number(rawId), user.id);
    if (!play || !plays.finish(play)) return json(res, 409, { error: 'This try has already ended.' });
    json(res, 200, { ok: true });
  }, 'stages'],

  // Starts a try at a level, or picks up the one this player has open. A finished level can't be played again.
  ['POST', new RegExp(`^/api/quests/${ID_PATH}/start$`), (req, res, url, rawId) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play.' });
    ensureProfile(db, user);
    const id = Number(rawId);
    const level = questPath(user.id).find((l) => l.id === id);
    if (!level) return json(res, 404, { error: 'That level does not exist.' });
    if (level.status === 'locked') return json(res, 403, { error: 'Finish the level before this one first.' });
    if (level.status === 'done') return json(res, 409, { error: 'You have already finished this level.', code: 'done' });
    let play = openQuestPlay(db, id, user.id);
    if (!play) {
      const questionIds = questQuestions(QUEST_BY_ID.get(id));
      if (!questionIds.length) return json(res, 409, { error: 'This level is not available right now.', code: 'unavailable' });
      play = plays.begin({ kind: 'quest', ref: `${id}:${randomUUID()}`, userId: user.id, questionIds });
    }
    json(res, 200, { level, play: plays.view(play) });
  }, 'stages'],

  // Ends the player's open try where it stands (they left): the question on screen counts as wrong.
  ['POST', new RegExp(`^/api/quests/${ID_PATH}/finish$`), (req, res, url, rawId) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to play.' });
    const play = openQuestPlay(db, Number(rawId), user.id);
    if (!play || !plays.finish(play)) return json(res, 409, { error: 'This try has already ended.' });
    json(res, 200, { ok: true });
  }, 'stages'],

  // The Leveling dashboard. Every one of these checks for an admin (see adminRoute).
  ['GET', new RegExp(`^/api/admin/stages/${ID_PATH}$`), adminRoute((input, id) => stageForAdmin(db, id))],
  ['PUT', new RegExp(`^/api/admin/stages/${ID_PATH}$`), adminRoute((input, id) => ({ stage: updateStage(db, id, input) }))],
  ['DELETE', new RegExp(`^/api/admin/stages/${ID_PATH}$`), adminRoute((input, id) => {
    deleteStage(db, id);
    return { ok: true };
  })],
  ['POST', new RegExp(`^/api/admin/stages/${ID_PATH}/move$`), adminRoute((input, id) => ({ stages: moveStage(db, id, input.direction) }))],
  ['POST', new RegExp(`^/api/admin/stages/${ID_PATH}/questions$`), adminRoute((input, id) => addStageQuestion(db, id, input))],
  ['PUT', new RegExp(`^/api/admin/stages/${ID_PATH}/questions/${ID_PATH}$`), adminRoute((input, id, q) => updateStageQuestion(db, id, q, input))],
  ['DELETE', new RegExp(`^/api/admin/stages/${ID_PATH}/questions/${ID_PATH}$`), adminRoute((input, id, q) => deleteStageQuestion(db, id, q))],
  ['POST', new RegExp(`^/api/admin/stages/${ID_PATH}/questions/${ID_PATH}/move$`), adminRoute((input, id, q) => moveStageQuestion(db, id, q, input.direction))],

  // One question at a time (see server/play.js).
  ['POST', new RegExp(`^/api/plays/${PLAY_PATH}/open$`), playRoute((play, input) => plays.open(play, input.idx)), 'play'],
  ['POST', new RegExp(`^/api/plays/${PLAY_PATH}/answer$`), playRoute((play, input) => plays.answer(play, input.idx, input.choice)), 'play'],
  ['POST', new RegExp(`^/api/plays/${PLAY_PATH}/skip$`), playRoute((play, input) => plays.skip(play, input.idx)), 'play'],

  ['POST', new RegExp(`^/api/duels/${DUEL_PATH}/rematch$`), (req, res, url, id) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in first.' });
    const duel = getDuel(db, id);
    if (!duel) return json(res, 404, { error: 'This duel link is no longer valid.' });
    const otherId = duel.challengerId === user.id ? duel.opponentId : duel.opponentId === user.id ? duel.challengerId : null;
    if (!otherId) return json(res, 409, { error: 'There is nobody to play a rematch with.' });
    // Both may tap Rematch: whoever is second joins the one already waiting.
    const waiting = openRematch(db, id);
    if (waiting) {
      try {
        joinDuel(user, waiting);
      } catch (err) {
        if (!err.status) throw err;
        return json(res, err.status, { error: err.message, live: err.live ?? null });
      }
      return json(res, 200, { duel: duelView(getDuel(db, waiting), user.id) });
    }
    const busy = matches.liveFor(user.id);
    if (busy) return json(res, 409, { error: 'You are already in a live duel.', live: busy });
    if (openDuelCount(db, user.id) >= DUEL.maxOpen) return json(res, 409, { error: `You have ${DUEL.maxOpen} duels waiting. Finish some first.` });
    const rematch = createDuel(db, { id: randomCode(8), challengerId: user.id, invitedId: otherId, category: duel.category, rematchOf: id });
    matches.open({ ...rematch, avoid: duel.questionIds });
    matches.offerRematch(id, rematch.id);
    reminders.duelSent(otherId, rematch.id, { name: getProfile(db, user.id).name });
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
 * Grades a Quick or topic round, from shared/questions.js. These only count towards the player's
 * own progress; Daily and duel answers are graded one at a time in server/play.js.
 */
function grade(answers, { modeCfg = MODES[DEFAULT_MODE] } = {}) {
  if (!Array.isArray(answers) || answers.length > 50 || !answers.length) throw badRequest('A round needs between 1 and 50 answers.');
  const graded = [];
  const seen = new Set();
  for (const a of answers) {
    const q = QUESTION_BY_ID.get(a?.id);
    if (!q) throw badRequest(`Unknown question "${a?.id}".`);
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
function saveFixedRound(userId, category, graded, skippedMs, xp) {
  const time = graded.reduce((sum, a) => sum + a.ms, 0) + skippedMs;
  if (!graded.length) return { roundId: null, score: 0, correct: 0, ms: time };
  const r = saveRound(db, userId, { mode: DEFAULT_MODE, category, graded, complete: xp }); // only a complete round earns XP
  if (xp) logEvent(db, userId, 'round_finished', { mode: DEFAULT_MODE, category, correct: r.correct, total: r.total, score: r.score });
  return { roundId: r.roundId, score: r.score, correct: r.correct, ms: time };
}

/** A try at a stage has ended on the server: saves it, with the first clear's bonus. */
function finishStage(play, graded) {
  const stageId = Number(play.ref.split(':')[0]);
  const r = finishStageTry(db, {
    userId: play.userId, stageId, mode: DEFAULT_MODE, graded, total: play.questionIds.length, played: play.answers.some((a) => !a.skipped),
  });
  if (r.round) logEvent(db, play.userId, 'round_finished', { mode: DEFAULT_MODE, category: 'stage', stage: stageId, correct: r.correct, total: r.total, score: r.score, cleared: r.cleared, firstClear: r.firstClear });
}

/**
 * The Levels as one player stands on them. A level opens when the one before it is finished, and
 * a finished one stays finished. `aced` are friends who finished it on their first try.
 */
function questPath(userId) {
  const mine = questResults(db, userId);
  const aced = friendsFirstTry(db, userId);
  let unlocked = true;
  return QUESTS.map((quest, i) => {
    const r = mine.get(quest.id);
    const done = !!r?.completedAt;
    const status = done ? 'done' : unlocked ? 'open' : 'locked';
    unlocked &&= done;
    const count = questQuestions(quest).length;
    const friends = aced.get(quest.id) ?? [];
    const lastWon = done && r.last?.at === r.completedAt; // the try that finished it was the last one
    return {
      id: quest.id, n: i + 1, topic: quest.topic, cover: quest.cover, count, status,
      attempts: r?.attempts ?? 0, best: r?.best ?? 0, firstTry: !!r?.firstTry,
      last: r?.last ? { ...r.last, completed: lastWon, firstTry: lastWon && r.firstTry } : null,
      prize: questPrize(count), firstTryPrize: questPrize(count, true),
      aced: friends.slice(0, QUEST.acedShown), acedCount: friends.length,
    };
  });
}

/** A try at a level has ended on the server: saves it with its prize. */
function finishQuest(play, graded) {
  const questId = Number(play.ref.split(':')[0]);
  const r = finishQuestTry(db, { userId: play.userId, questId, mode: DEFAULT_MODE, graded, total: play.questionIds.length });
  if (r.round) logEvent(db, play.userId, 'round_finished', { mode: DEFAULT_MODE, category: 'quest', level: questId, correct: r.solved, total: r.total, score: r.round.score, completed: r.completed, firstTry: r.firstTry });
}

/** A Daily, duel, Leveling or Levels round has ended on the server: saves the result and tells whoever should hear. */
function finishFixedRound(play, graded, skippedMs, { xp }) {
  if (play.kind === 'stage') return finishStage(play, graded);
  if (play.kind === 'quest') return finishQuest(play, graded);
  const saved = saveFixedRound(play.userId, play.kind, graded, skippedMs, xp);
  if (play.kind === 'daily') {
    finishDaily(db, play.ref, play.userId, { ...saved, total: play.questionIds.length });
    // Friends who already played and scored less hear about it (if they asked to).
    const me = getProfile(db, play.userId);
    for (const f of friendsBeaten(db, play.ref, play.userId, saved.score)) {
      reminders.friendBeatYou(f.user_id, `${play.ref}:${play.userId}`, { name: me.name, their: saved.score, yours: f.score });
    }
    return;
  }
  finishDuelSide(db, play.ref, play.side, saved); // server/match.js says who won and tells whoever missed it
}

/**
 * A Daily date as the player's own calendar date. Time zones run from UTC-12 to UTC+14, so it's
 * within a day of the server's UTC date; anything else is refused.
 */
function dailyDate(value) {
  const today = localDate(0);
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
  const away = Math.abs(Date.parse(date) - Date.parse(today)); // NaN for a date that doesn't exist, like 2026-99-99
  if (!(away <= 86_400_000) || date < DAILY.start) throw badRequest('That Daily is not available.');
  return date;
}

const dailyFor = (date) => getDaily(db, date, dailyNumber(date), (recent) => pickQuestions({ count: DAILY.questions, seed: `daily:${date}`, avoid: recent }));

/** Questions any of these players met lately, so a new duel can stay away from them. */
const seenByPlayers = (...userIds) => new Set(userIds.filter(Boolean).flatMap((id) => recentQuestionIds(db, id)));

/** Where a duel stands for one player. Before it's over, nobody is told anything about the score. */
function duelStatus(d, role, viewerId) {
  if (d.endReason === 'expired' || d.endReason === 'retired') return 'expired';
  if (d.endReason === 'abandoned') return 'abandoned';
  if (d.finishedAt) return role ? 'done' : 'taken';
  if (!matches.isOpen(d.id)) return 'expired'; // not running any more, whatever the database last heard
  const inLobby = !d.live || d.live.phase === 'lobby';
  if (role) return !inLobby ? 'live' : role === 'challenger' ? 'hosting' : 'joined';
  if (d.opponentId || (d.invitedId && d.invitedId !== viewerId)) return 'taken';
  return d.invitedId === viewerId ? 'invited' : 'open';
}

/**
 * A duel as one player sees it. Everyone sees who is in it; the scores and answers are shown to
 * its two players once it's over.
 */
function duelView(d, viewerId, { brief = false } = {}) {
  const role = d.challengerId === viewerId ? 'challenger' : d.opponentId === viewerId ? 'opponent' : null;
  const person = (id, side) => {
    const p = id && getProfile(db, id);
    return { ...(p ? shownProfile(p) : { id: null, name: null, avatar: null, country: null, gone: side.score !== null }), score: d.finishedAt ? side.score : null, correct: d.finishedAt ? side.correct : null, ms: d.finishedAt ? side.ms : null };
  };
  const view = {
    id: d.id, category: d.category, role, status: duelStatus(d, role, viewerId), winner: duelWinner(d), invited: d.invitedId === viewerId,
    resultReady: d.resultUnseenBy === viewerId, isFriend: areFriends(db, viewerId, d.challengerId), endReason: d.endReason, forfeitSide: d.forfeitSide,
    challenger: person(d.challengerId, d.challenger),
    opponent: d.opponentId || d.opponent.score !== null ? person(d.opponentId, d.opponent) : null,
    invitedFriend: !d.opponentId && d.invitedId ? shownProfile(getProfile(db, d.invitedId) ?? { id: d.invitedId, name: null }) : null,
    createdAt: d.createdAt, finishedAt: d.finishedAt, count: d.questionIds.length || DUEL.questions,
    canRematch: !!role && matches.isOpen(d.id),
    coins: role && d.finishedAt && !brief ? duelCoinsEarned(db, d.id, role, viewerId) : 0,
  };
  if (brief) return view;
  if (d.finishedAt && role && d[role].score !== null) {
    view.questionIds = d.questionIds;
    view.questions = contentFor(d.questionIds);
    view.answers = { challenger: roundAnswers(db, d.challenger.roundId), opponent: roundAnswers(db, d.opponent.roundId) };
  }
  return view;
}

/** Takes the second seat of a duel. */
function joinDuel(user, id) {
  ensureProfile(db, user);
  const state = matches.join(id, user.id);
  const duel = getDuel(db, id);
  if (duel && duel.challengerId !== user.id) {
    try { addFriend(db, user.id, duel.challengerId); } catch { /* at the friend limit: play anyway */ }
  }
  return state;
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
const QUESTIONS_PER_REQUEST = 20; // a round, with a few to spare
const MISSED_SHOWN = 6; // "questions you miss most" on the Progress page
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
  play: rateLimiter({ limit: 300, windowMs: 10 * MINUTE }), // opening and answering Daily and duel questions
  questions: rateLimiter({ limit: 40, windowMs: 10 * MINUTE }), // Quick rounds' questions, per browser
  duels: rateLimiter({ limit: 40, windowMs: 10 * MINUTE }), // joining duels
  live: rateLimiter({ limit: 200, windowMs: MINUTE }), // everything a browser says during a live duel
  duelCreate: rateLimiter({ limit: 30, windowMs: 60 * MINUTE }), // new duels and rematches
  stages: rateLimiter({ limit: 60, windowMs: 10 * MINUTE }), // starts and early finishes of Leveling and Levels tries
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
  'POST /api/shop/buy': 'rounds',
  'POST /api/questions': 'questions',
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
  const checks = [LIMITS.perAddress(ip)];
  // A live duel makes several small requests per question, and must never be cut off for that.
  if (routeLimit !== 'live') checks.push(LIMITS.perClient(client));
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
// replaced picture shows up by the next day). Topic photos never change at their address (see
// shared/covers.js), so they're kept for good. Everything else is checked with the server on
// each load (cheap: an unchanged file is answered with "304 Not Modified" and no body).
const LONG_CACHE = /^\/(img|signs)\//;
const cacheRule = (pathname) => (pathname.startsWith('/topics/') ? 'public, max-age=31536000, immutable' : LONG_CACHE.test(pathname) ? 'public, max-age=86400' : 'no-cache');

async function sendFile(req, res, file, pathname) {
  const info = await stat(file);
  if (!info.isFile()) return false;
  const ext = extname(file).toLowerCase();
  const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cacheRule(pathname),
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

// The shared files browsers use. Listed one by one so that shared/questions.js, which has the
// right answers, can't be fetched under another spelling of its address.
const BROWSER_SHARED = new Set(['avatars.js', 'config.js', 'countries.js', 'covers.js', 'geo.js', 'levels.js']);
const browserBank = { data: Buffer.from(BROWSER_BANK), gzip: gzipSync(BROWSER_BANK) };
const browserBankEtag = `"${createHash('sha256').update(BROWSER_BANK).digest('hex').slice(0, 16)}"`;

function sendBrowserBank(req, res) {
  const headers = { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache', ETag: browserBankEtag, Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === browserBankEtag) return send(res, 304, undefined, headers);
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return send(res, 200, browserBank.gzip, { ...headers, 'Content-Encoding': 'gzip' });
  send(res, 200, browserBank.data, headers);
}

/** A question's picture during a Daily or duel, at an address that says nothing about it. */
async function sendPlayPicture(req, res, playId, idx) {
  const user = currentUser(req);
  const play = user ? plays.get(playId) : null;
  const file = play && play.userId === user.id ? plays.pictureFile(play, idx) : null;
  if (!file) return send(res, 404, 'Not found');
  const data = await readFile(file);
  send(res, 200, data, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' });
}

const STATIC_ROOTS = [
  ['/shared/', join(ROOT, 'shared')],
  ['/', join(ROOT, 'public')],
];

async function serveStatic(req, res, pathname) {
  if (pathname === '/shared/questions.js') return sendBrowserBank(req, res);
  const picture = /^\/pic\/([0-9a-f-]{36})\/(\d{1,2})$/.exec(pathname);
  if (picture) return sendPlayPicture(req, res, picture[1], Number(picture[2]));
  for (const [prefix, dir] of STATIC_ROOTS) {
    if (!pathname.startsWith(prefix)) continue;
    let rel;
    try {
      rel = normalize(decodeURIComponent(pathname.slice(prefix.length))).replace(/^([/\\])+/, '');
    } catch {
      return send(res, 400, 'Bad path');
    }
    if (prefix === '/shared/' && !BROWSER_SHARED.has(rel)) return send(res, 404, 'Not found');
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

// Live duels that were running when the server stopped pick up again, and all of them move from here.
matches.restore();
setInterval(() => matches.tick(), 100).unref();

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
