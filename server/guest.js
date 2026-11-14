// One Quick round for visitors who haven't signed in, so a link from a video can open straight
// into a game. Nothing about it is stored: no account, no saved answers, no XP. The browser
// grades the round itself, as in any Quick round, and the result stays on its screen.
//
// Each browser gets one guest round. It's marked by a cookie that outlives the round, so a
// browser that has played (or started) one is asked to sign in from then on. Clearing cookies
// starts over, which is what the per-address limit is for: each IP address may start only a
// few guest rounds an hour. Several phones often share one address on mobile data, so that
// limit leaves some room.

import { randomBytes } from 'node:crypto';

export const GUEST_COOKIE = 'smarts_guest';
const COOKIE_DAYS = 365;

export const GUEST = {
  roundQuestions: 10, // the first request: the round itself
  maxQuestions: 20, // everything one guest round may load, replacements for pictures that won't load included
  windowMs: 30 * 60_000, // how long a guest round may keep loading replacements
  perAddress: 10, // new guest rounds per IP address
  perAddressMs: 60 * 60_000, // ...in this window
};

const MAX_ROUNDS = 50_000; // memory guard
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export function guestCookie(token, { secure }) {
  const attrs = [`${GUEST_COOKIE}=${token}`, 'Path=/api/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${COOKIE_DAYS * 86400}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

const refused = (code, status, message, extra = {}) => ({ ok: false, code, status, error: message, ...extra });

/**
 * Keeps track of guest rounds in memory. A server restart forgets the open ones; their browsers
 * still have the cookie, so they're asked to sign in rather than given a second round.
 */
export function createGuestRounds(limits = GUEST) {
  const rounds = new Map(); // token -> { started, served: Set of question ids }
  const starts = new Map(); // ip -> { count, resetAt }

  function sweep(now) {
    for (const [token, r] of rounds) if (r.started + limits.windowMs <= now) rounds.delete(token);
    for (const [ip, w] of starts) if (w.resetAt <= now) starts.delete(ip);
  }

  function startAllowed(ip, now) {
    let w = starts.get(ip);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + limits.perAddressMs };
      starts.set(ip, w);
    }
    if (w.count >= limits.perAddress) return { ok: false, retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
    w.count += 1;
    return { ok: true };
  }

  return {
    /** Whether this browser may still start its guest round. */
    available: (token) => !token,

    /**
     * The questions of a guest round. `token` is the browser's guest cookie, if it has one;
     * `ids` the question ids asked for, all of which must exist. Returns { ok: true, token, ids,
     * fresh } with the ids to send (fresh says the cookie must be set), or a refusal.
     */
    serve(token, ip, ids, now = Date.now()) {
      if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string')) {
        return refused('bad', 400, 'Ask for at least one question.');
      }
      const unique = [...new Set(ids)];
      if (token) {
        const r = TOKEN.test(token) ? rounds.get(token) : null;
        if (!r || r.started + limits.windowMs <= now) return refused('guestUsed', 403, 'Sign in to keep playing.');
        const fresh = unique.filter((id) => !r.served.has(id));
        if (r.served.size + fresh.length > limits.maxQuestions) return refused('guestUsed', 403, 'Sign in to keep playing.');
        for (const id of fresh) r.served.add(id);
        return { ok: true, token, ids: unique, fresh: false };
      }
      if (unique.length > limits.roundQuestions) return refused('bad', 400, `A guest round has at most ${limits.roundQuestions} questions.`);
      if (rounds.size >= MAX_ROUNDS || starts.size >= MAX_ROUNDS) sweep(now);
      if (rounds.size >= MAX_ROUNDS) return refused('guestBusy', 503, 'Too many guests right now. Sign in to play.');
      const allowed = startAllowed(ip, now);
      if (!allowed.ok) return refused('guestLimit', 429, 'Too many guest rounds from this network. Sign in to play.', { retryAfter: allowed.retryAfter });
      const fresh = randomBytes(16).toString('base64url');
      rounds.set(fresh, { started: now, served: new Set(unique) });
      return { ok: true, token: fresh, ids: unique, fresh: true };
    },

    sweep,
  };
}
