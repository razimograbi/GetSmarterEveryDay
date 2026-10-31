import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  openDb, upsertUser, deleteUser, saveRound, getStats, exportUser,
  createSession, sessionUser, deleteSession, deleteUserSessions, purgeExpiredSessions,
  getSettings, saveSettings, saveReport, listReports, resolveReports, REPORT_STATUSES,
} from './db.js';
import {
  verifyGoogleIdToken, sessionCookie, clearedCookie, parseCookies, SESSION_COOKIE, SESSION_TTL_MS,
} from './auth.js';
import { rateLimiter, clientIp, capacityGate } from './ratelimit.js';
import { QUESTION_BY_ID } from '../shared/questions.js';
import { MODES, CATEGORY_BY_ID, REPORT_REASONS, REPORT_NOTE_MAX, pointsFor, secondsFor } from '../shared/config.js';

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

// Expired sessions are useless; clear them out now and every hour.
purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 3_600_000).unref();

// ── HTTP helpers ───────────────────────────────────────────────

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "frame-src https://accounts.google.com/gsi/",
  "connect-src 'self' https://accounts.google.com/gsi/ https://en.wikipedia.org https://cdn.jsdelivr.net https://unpkg.com",
  "img-src 'self' data: https://flagcdn.com https://upload.wikimedia.org https://thumb.wikimedia.org https://server.arcgisonline.com https://*.googleusercontent.com",
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
  json(res, 200, { user: publicUser(user), settings: getSettings(db, user.id), locale }, {
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
    json(res, 200, { googleClientId: GOOGLE_CLIENT_ID || null, devLogin: DEV_LOGIN }),

  'GET /api/me': (req, res) => {
    const user = currentUser(req);
    json(res, 200, { user: publicUser(user), settings: user ? getSettings(db, user.id) : null });
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
    if (!Array.isArray(answers) || !answers.length || answers.length > 50) return json(res, 400, { error: 'A round needs between 1 and 50 answers.' });

    const graded = [];
    const seen = new Set();
    for (const a of answers) {
      const q = QUESTION_BY_ID.get(a?.id);
      if (!q) return json(res, 400, { error: `Unknown question "${a?.id}".` });
      if (seen.has(q.id)) return json(res, 400, { error: `Question "${q.id}" appears twice in one round.` });
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
    const result = saveRound(db, user.id, { mode, category, graded, complete: partial !== true });
    json(res, 200, { ...result, graded: graded.map(({ id, correct, points }) => ({ id, correct, points })) });
  },

  'GET /api/stats': (req, res, url) => {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to see your progress.' });
    // Time zones run from UTC-12 to UTC+14; anything else is nonsense.
    const tz = Math.max(-840, Math.min(720, Math.round(Number(url.searchParams.get('tz')) || 0)));
    json(res, 200, getStats(db, user.id, { tzOffsetMin: tz }));
  },
};

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
};

let warnedAboutProxy = false;

/** Counts this API request. Returns the seconds to wait if it is over a limit, else 0. */
function overLimit(req, route) {
  if (!TRUST_PROXY && req.headers['x-forwarded-for'] && !warnedAboutProxy) {
    warnedAboutProxy = true;
    console.warn('  Requests arrive through a proxy, but TRUST_PROXY is not set: all players share one rate limit. Set TRUST_PROXY=1.');
  }
  const ip = clientIp(req, TRUST_PROXY);
  const client = sessionToken(req) || ip; // signed-in players are counted per session, others per address
  const routeLimit = ROUTE_LIMITS[route];
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
  // Standalone pages with a clean address (the privacy policy is linked from Google's sign-in screen).
  if (pathname === '/privacy' || pathname === '/privacy/') {
    await sendFile(req, res, join(ROOT, 'public', 'privacy.html'), '/privacy.html');
    return;
  }
  // Single-page app: unknown non-file paths get the app shell.
  if (!extname(pathname)) {
    await sendFile(req, res, join(ROOT, 'public', 'index.html'), '/index.html');
    return;
  }
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
      const wait = overLimit(req, route);
      if (wait) {
        return json(res, 429, { error: `Too many requests. Wait ${wait} seconds and try again.` }, { 'Retry-After': String(wait) });
      }
      // Session cookies are SameSite=Lax already; this also stops other sites' scripts outright.
      if (req.method !== 'GET' && crossSite(req)) return json(res, 403, { error: 'Requests from other websites are not allowed.' });
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
    db.close();
    process.exit(0);
  });
}
