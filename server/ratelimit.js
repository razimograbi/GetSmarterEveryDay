// In-memory rate limiting. Fine for one server process (see "Running it for real" in the
// README); with several processes each would count separately.

const MAX_KEYS = 50_000; // memory guard: past this, expired entries are dropped, then everything

/**
 * A fixed-window counter: each key may make `limit` requests per `windowMs`.
 * Returns hit(key) -> { ok, retryAfter } where retryAfter is in seconds.
 */
export function rateLimiter({ limit, windowMs }) {
  const windows = new Map(); // key -> { count, resetAt }

  const sweep = () => {
    const now = Date.now();
    for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
  };
  setInterval(sweep, windowMs).unref();

  return function hit(key) {
    const now = Date.now();
    let w = windows.get(key);
    if (!w || w.resetAt <= now) {
      if (windows.size >= MAX_KEYS) {
        sweep();
        if (windows.size >= MAX_KEYS) windows.clear(); // under a flood from many addresses, fail open rather than run out of memory
      }
      w = { count: 0, resetAt: now + windowMs };
      windows.set(key, w);
    }
    w.count++;
    return { ok: w.count <= limit, retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  };
}

/**
 * Caps how many players use the app at once. A player is active from their first request
 * until `idleMs` passes without one; once `max` players are active, new ones are turned
 * away until a slot frees up. Players already in keep playing.
 *
 * Signed-in players are recognised by their session token, visitors who haven't signed in
 * yet by IP address. Signing in keeps the visitor's slot instead of taking a second one.
 */
export function capacityGate({ max, idleMs }) {
  const owner = new Map(); // session token or IP -> player
  const players = new Set(); // { last, token }

  const fresh = (p, now) => !!p && p.last > now - idleMs;
  const sweep = (now) => {
    for (const p of players) if (!fresh(p, now)) players.delete(p);
    for (const [key, p] of owner) if (!players.has(p)) owner.delete(key);
  };
  setInterval(() => sweep(Date.now()), 60_000).unref();

  return {
    /** True if this request may go ahead (a known player, or a free slot for a new one). */
    admit(token, ip, now = Date.now()) {
      let p = owner.get(token || ip);
      if (!fresh(p, now) && token) {
        const visitor = owner.get(ip);
        if (fresh(visitor, now) && !visitor.token) p = visitor; // just signed in: keep the same slot
      }
      if (!fresh(p, now)) {
        sweep(now);
        if (players.size >= max) return false;
        p = { last: now, token: null };
        players.add(p);
      }
      p.last = now;
      if (token) {
        p.token = token;
        owner.set(token, p);
      } else {
        owner.set(ip, p);
      }
      return true;
    },
    active(now = Date.now()) {
      sweep(now);
      return players.size;
    },
  };
}

/**
 * The client's IP address. Behind a reverse proxy (Caddy, nginx, Fly.io) every request
 * comes from the proxy, so with `trustProxy` the address the proxy added last to
 * X-Forwarded-For is used instead. Only turn that on behind a proxy: otherwise anyone
 * can send the header and pretend to be someone else.
 */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const last = typeof forwarded === 'string' ? forwarded.split(',').at(-1).trim() : '';
    if (last) return last;
  }
  return req.socket.remoteAddress || 'unknown';
}
