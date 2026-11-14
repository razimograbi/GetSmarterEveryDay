// The one round a visitor may play before signing in (server/guest.js).
// Run with `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGuestRounds, guestCookie, GUEST } from '../server/guest.js';

const ids = (n, from = 0) => Array.from({ length: n }, (_, i) => `q${from + i}`);

test('a browser without the cookie gets one round and a cookie for it', () => {
  const guests = createGuestRounds();
  assert.equal(guests.available(undefined), true);
  const r = guests.serve(undefined, '1.1.1.1', ids(10), 0);
  assert.equal(r.ok, true);
  assert.equal(r.fresh, true);
  assert.match(r.token, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(r.ids, ids(10));
  assert.equal(guests.available(r.token), false);
});

test('the same round may load replacements, up to its budget', () => {
  const guests = createGuestRounds();
  const { token } = guests.serve(undefined, '1.1.1.1', ids(10), 0);
  const more = guests.serve(token, '1.1.1.1', ids(4, 10), 1000);
  assert.equal(more.ok, true);
  assert.equal(more.fresh, false);
  assert.equal(guests.serve(token, '1.1.1.1', ids(4), 2000).ok, true, 'asking again for ones already sent costs nothing');
  assert.equal(guests.serve(token, '1.1.1.1', ids(6, 14), 3000).ok, true); // 20 in all
  const over = guests.serve(token, '1.1.1.1', ['q99'], 4000);
  assert.equal(over.ok, false);
  assert.equal(over.code, 'guestUsed');
});

test('a second round needs signing in', () => {
  const guests = createGuestRounds();
  const { token } = guests.serve(undefined, '1.1.1.1', ids(10), 0);
  const late = guests.serve(token, '1.1.1.1', ids(10, 10), GUEST.windowMs + 1);
  assert.equal(late.ok, false);
  assert.equal(late.code, 'guestUsed');
  assert.equal(late.status, 403);
});

test('a cookie the server does not know (made up, or from before a restart) is refused', () => {
  const guests = createGuestRounds();
  assert.equal(guests.serve('A'.repeat(22), '1.1.1.1', ids(1), 0).code, 'guestUsed');
  assert.equal(guests.serve('not a token', '1.1.1.1', ids(1), 0).code, 'guestUsed');
});

test('a guest round can not start bigger than a round', () => {
  const guests = createGuestRounds();
  const r = guests.serve(undefined, '1.1.1.1', ids(GUEST.roundQuestions + 1), 0);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(guests.serve(undefined, '1.1.1.1', [], 0).status, 400);
  assert.equal(guests.serve(undefined, '1.1.1.1', [5], 0).status, 400);
});

test('each address may start only a few guest rounds an hour', () => {
  const guests = createGuestRounds();
  for (let i = 0; i < GUEST.perAddress; i++) assert.equal(guests.serve(undefined, '2.2.2.2', ids(10), i).ok, true);
  const blocked = guests.serve(undefined, '2.2.2.2', ids(10), 100);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'guestLimit');
  assert.equal(blocked.status, 429);
  assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= GUEST.perAddressMs / 1000);
  assert.equal(guests.serve(undefined, '3.3.3.3', ids(10), 100).ok, true, 'other addresses are not affected');
  assert.equal(guests.serve(undefined, '2.2.2.2', ids(10), GUEST.perAddressMs + 1).ok, true, 'and the window passes');
});

test('replacements within a round do not count against the address', () => {
  const guests = createGuestRounds({ ...GUEST, perAddress: 1 });
  const { token } = guests.serve(undefined, '4.4.4.4', ids(10), 0);
  assert.equal(guests.serve(token, '4.4.4.4', ids(4, 10), 10).ok, true);
});

test('sweep forgets finished rounds and old address counts', () => {
  const guests = createGuestRounds({ ...GUEST, perAddress: 1 });
  const { token } = guests.serve(undefined, '5.5.5.5', ids(10), 0);
  guests.sweep(GUEST.perAddressMs + 1);
  assert.equal(guests.serve(token, '5.5.5.5', ids(1), GUEST.perAddressMs + 2).code, 'guestUsed', 'the cookie still says the round was played');
  assert.equal(guests.serve(undefined, '5.5.5.5', ids(10), GUEST.perAddressMs + 2).ok, true);
});

test('the cookie is HttpOnly, only sent to the API, and Secure when asked', () => {
  const c = guestCookie('abc', { secure: false });
  assert.match(c, /^smarts_guest=abc; /);
  assert.match(c, /Path=\/api\//);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.doesNotMatch(c, /Secure/);
  assert.match(guestCookie('abc', { secure: true }), /; Secure$/);
});
