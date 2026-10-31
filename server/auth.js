// Google ID token verification and session cookies, using only node:crypto.
// The sessions themselves live in the database (see server/db.js).

import { createPublicKey, verify } from 'node:crypto';

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

let certCache = { keys: new Map(), expires: 0 };

async function googleKey(kid) {
  if (Date.now() > certCache.expires || !certCache.keys.has(kid)) {
    const res = await fetch(GOOGLE_CERTS_URL);
    if (!res.ok) throw new Error(`Could not fetch Google signing keys (HTTP ${res.status})`);
    const { keys } = await res.json();
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
    certCache = {
      keys: new Map(keys.map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })])),
      expires: Date.now() + maxAge * 1000,
    };
  }
  const key = certCache.keys.get(kid);
  if (!key) throw new Error('Unknown Google signing key');
  return key;
}

const b64urlJson = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/** Verifies a Google Identity Services credential (an ID token) and returns its claims. */
export async function verifyGoogleIdToken(token, clientId) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [h, p, s] = parts;
  const header = b64urlJson(h);
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');

  const key = await googleKey(header.kid);
  const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('Bad token signature');

  const claims = b64urlJson(p);
  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new Error('Wrong token issuer');
  if (claims.aud !== clientId) throw new Error('Token was issued for a different app');
  if (typeof claims.exp !== 'number' || claims.exp < now - 30) throw new Error('Token expired');
  if (claims.email && claims.email_verified === false) throw new Error('Google email is not verified');
  return claims;
}

// ── Sessions ───────────────────────────────────────────────────

export const SESSION_COOKIE = 'smarts_session';
const SESSION_DAYS = 30;
export const SESSION_TTL_MS = SESSION_DAYS * 86_400_000;

export function sessionCookie(value, { secure }) {
  const attrs = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearedCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function parseCookies(header = '') {
  const out = {};
  for (const pair of header.split(';')) {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  }
  return out;
}
