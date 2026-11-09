// Live duels, played by two simulated players against a clock the test controls.
// Run with `npm test`.

import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDuel, finishDuelSide, getDuel, openDb, upsertUser } from '../server/db.js';
import { createPlays } from '../server/play.js';
import { serverNow } from '../server/clock.js';
import { createMatches } from '../server/match.js';
import { pickQuestions } from '../server/pick.js';
import { QUESTION_BY_ID } from '../shared/questions.js';
import { MATCH, PLAY } from '../shared/config.js';

const dir = mkdtempSync(join(tmpdir(), 'smarts-match-'));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
afterEach(() => db.close());

let file = 0;
let db;
let plays;
let matches;
let pushes;
let clock;
let alive; // players whose browsers keep saying they're there
let duel;

function build() {
  plays = createPlays(db, {
    onFinish: (play, graded, skippedMs) => finishDuelSide(db, play.ref, play.side, {
      roundId: null, score: graded.reduce((s, a) => s + a.points, 0), correct: graded.filter((a) => a.correct).length, ms: graded.reduce((s, a) => s + a.ms, skippedMs),
    }),
  });
  pushes = [];
  matches = createMatches(db, {
    plays, clock: () => clock.t,
    profileOf: (id) => ({ id, name: id, avatar: null }),
    pick: () => pickQuestions({ count: 10, category: 'mixed', seed: 'test' }),
    reminders: { duelJoined: (...a) => pushes.push(['joined', ...a]), duelFinished: (...a) => pushes.push(['finished', ...a]) },
    log: (...a) => { throw a[1] ?? new Error(a.join(' ')); },
  });
}

beforeEach(() => {
  db = openDb(join(dir, `t${file++}.db`));
  clock = { t: 1_000_000 };
  alive = new Set(['ann', 'bob']);
  for (const id of ['ann', 'bob']) upsertUser(db, { id, name: id, provider: 'dev' });
  build();
  duel = createDuel(db, { id: 'AAAAAAAA', challengerId: 'ann', category: 'mixed' });
  matches.open(duel, clock.t);
});

function stream() {
  return {
    events: [], ended: false,
    write(s) {
      const [, event, data] = /^event: (\w+)\ndata: (.*)\n\n$/s.exec(s);
      this.events.push({ event, data: JSON.parse(data) });
    },
    end() { this.ended = true; },
    get last() { return this.events.filter((e) => e.event === 'state').at(-1)?.data; },
  };
}

/** Lets time pass. Browsers still here keep their heartbeat going. */
function run(ms) {
  for (let left = ms; left > 0; left -= 100) {
    clock.t += 100;
    if ((clock.t % MATCH.beatEveryMs) < 100) for (const id of alive) try { matches.beat(duel.id, id, clock.t); } catch { /* not seated */ }
    matches.tick(clock.t);
  }
}

const state = (id) => matches.state(duel.id, id, clock.t);
const question = (idx) => QUESTION_BY_ID.get(getDuel(db, duel.id).questionIds[idx]);
const right = (idx) => question(idx).answer;
const wrong = (idx) => question(idx).wrong[0];

/** The player's connection closes and their browser goes quiet. */
function drop(id) {
  matches.attach(duel.id, id, stream(), clock.t)();
  alive.delete(id);
}
const answer = (id, idx, choice) => matches.answer(duel.id, id, idx, choice, false, clock.t);

/** Both connected and joined, and the match has got as far as the first "get ready". */
function begin() {
  const streams = { ann: stream(), bob: stream() };
  matches.attach(duel.id, 'ann', streams.ann, clock.t);
  matches.join(duel.id, 'bob', clock.t);
  matches.attach(duel.id, 'bob', streams.bob, clock.t);
  assert.equal(state('ann').phase, 'countdown');
  run(MATCH.countdownMs);
  assert.equal(state('ann').phase, 'prepare');
  return streams;
}

/** Both pictures are up: the question opens. */
function bothReady(idx) {
  matches.ready(duel.id, 'ann', idx, false, clock.t);
  matches.ready(duel.id, 'bob', idx, false, clock.t);
  assert.equal(state('ann').phase, 'answer');
}

function playQuestion(idx, a = right(idx), b = wrong(idx), after = 1000) {
  bothReady(idx);
  run(after);
  answer('ann', idx, a);
  answer('bob', idx, b);
  assert.equal(state('ann').phase, 'reveal');
  run(MATCH.revealMs + 100);
}

test('a question opens for both at once and stays secret until the picture is up', () => {
  const s = begin();
  const prep = state('bob');
  assert.equal(prep.question, undefined);
  assert.equal(JSON.stringify(prep).includes(question(0).prompt), false);
  bothReady(0);
  assert.equal(s.ann.last.phase, 'answer');
  assert.equal(s.bob.last.phase, 'answer');
  assert.equal(s.ann.last.v, s.bob.last.v);
  assert.equal(s.ann.last.question.prompt, question(0).prompt);
  assert.equal(JSON.stringify(s.ann.last).includes('"answer":'), false);
});

test('nobody learns anything until both have answered, and then only about themselves', () => {
  const s = begin();
  bothReady(0);
  run(2000);
  const reply = answer('ann', 0, right(0));
  assert.equal(reply.phase, 'answer');
  assert.equal(reply.answered, true);
  assert.equal(reply.result, undefined);
  assert.equal(reply.you.score, 0);
  assert.equal(s.bob.last.them.answered, true, 'Bob can see that Ann has answered');
  assert.equal(JSON.stringify(s.bob.last).includes(right(0)) && !s.bob.last.question.options.includes(right(0)), false);

  run(1000);
  const after = answer('bob', 0, wrong(0));
  assert.equal(after.phase, 'reveal');
  assert.equal(s.ann.last.result.correct, true);
  assert.equal(s.ann.last.result.answer, right(0));
  assert.equal(s.bob.last.result.correct, false);
  for (const v of [s.ann.last, s.bob.last]) {
    assert.deepEqual(Object.keys(v.them).sort(), ['answered', 'connected', 'profile']);
    assert.equal(JSON.stringify(v.them).includes('score'), false);
  }
});

test('the points split into the base point and the speed points', () => {
  const s = begin();
  bothReady(0);
  run(1000);
  matches.seen(duel.id, 'ann', 0, clock.t);
  answer('ann', 0, right(0));
  answer('bob', 0, wrong(0));
  const r = s.ann.last.result;
  assert.equal(r.base, 1);
  assert.equal(r.speed, 2);
  assert.equal(r.points, 3);
  assert.equal(s.ann.last.you.score, 3);
  assert.equal(s.bob.last.result.points, 0);
  assert.equal(s.bob.last.result.speed, 0);
});

test('each player\'s own measured delay comes off their time, up to the usual allowance', () => {
  const s = begin();
  bothReady(0);
  run(100);
  matches.seen(duel.id, 'ann', 0, clock.t); // 100 ms there and back
  run(900);
  matches.seen(duel.id, 'bob', 0, clock.t); // 1000 ms: capped
  run(1000);
  answer('ann', 0, right(0));
  answer('bob', 0, right(0));
  assert.equal(s.ann.last.result.ms, 2000 - 100);
  assert.equal(s.bob.last.result.ms, 2000 - PLAY.networkAllowanceMs);
});

test('a whole match: both move together and the winner is saved', () => {
  const s = begin();
  for (let idx = 0; idx < 10; idx++) {
    assert.equal(state('ann').idx, idx);
    assert.equal(state('bob').idx, idx);
    playQuestion(idx);
  }
  assert.equal(s.ann.last.phase, 'done');
  assert.equal(s.bob.last.phase, 'done');
  const d = getDuel(db, duel.id);
  assert.equal(d.challenger.correct, 10);
  assert.equal(d.opponent.correct, 0);
  assert.equal(d.endReason, 'played');
  assert.ok(d.finishedAt);
  assert.equal(d.live, null);
});

test('the first answer stands, and repeats and stale answers change nothing', () => {
  begin();
  bothReady(0);
  run(500);
  answer('ann', 0, wrong(0));
  answer('ann', 0, right(0));
  answer('bob', 3, right(0));
  assert.equal(state('bob').answered, false);
  answer('bob', 0, right(0));
  assert.equal(state('ann').result.correct, false);
  const v = state('ann').v;
  answer('ann', 0, right(0));
  assert.equal(state('ann').v, v);
  assert.equal(state('ann').result.correct, false);
});

test('a player who runs out of time scores nothing and the other is released', () => {
  const s = begin();
  bothReady(0);
  const seconds = s.ann.last.question.seconds;
  answer('ann', 0, right(0));
  assert.equal(state('ann').phase, 'answer');
  run(seconds * 1000 + PLAY.lateAllowanceMs + 100);
  assert.equal(state('ann').phase, 'reveal');
  assert.equal(s.bob.last.result.correct, false);
  assert.equal(s.bob.last.result.choice, null);
});

test('an answer after the question closed does not count', () => {
  const s = begin();
  bothReady(0);
  run(s.ann.last.question.seconds * 1000 + PLAY.lateAllowanceMs + 100);
  answer('ann', 0, right(0));
  assert.equal(state('ann').result.correct, false);
});

test('the slowest picture sets the pace, up to a limit', () => {
  begin();
  matches.ready(duel.id, 'ann', 0, false, clock.t);
  assert.equal(state('ann').phase, 'prepare');
  run(MATCH.prepareMs + 100);
  assert.equal(state('ann').phase, 'answer');
});

test('a picture that fails cancels the question for both, but only so often', () => {
  begin();
  for (let idx = 0; idx < MATCH.maxVoids; idx++) {
    matches.ready(duel.id, 'bob', idx, true, clock.t);
    const v = state('ann');
    assert.equal(v.phase, 'void');
    assert.equal(v.voidReason, 'picture');
    run(MATCH.voidMs + 100);
  }
  const idx = MATCH.maxVoids;
  matches.ready(duel.id, 'bob', idx, true, clock.t);
  assert.equal(state('ann').phase, 'prepare', 'out of cancels: it counts as ready');
  matches.ready(duel.id, 'ann', idx, false, clock.t);
  assert.equal(state('ann').phase, 'answer');
  const results = state('ann').you.results;
  assert.equal(results.filter((r) => r.skipped).length, MATCH.maxVoids);
});

test('a short drop between questions holds the game, and coming back carries on', () => {
  const s = begin();
  bothReady(0);
  answer('ann', 0, right(0));
  answer('bob', 0, wrong(0));
  drop('bob');
  run(MATCH.revealMs + 100); // Bob has been gone long enough by the next question
  assert.equal(s.ann.last.phase, 'prepare');
  matches.ready(duel.id, 'ann', 1, false, clock.t);
  run(MATCH.absentAfterMs + MATCH.prepareMs);
  assert.equal(s.ann.last.phase, 'prepare');
  assert.ok(s.ann.last.holdMs > 0, 'Ann is told the game is waiting');
  assert.equal(s.ann.last.them.connected, false);
  const back = stream();
  matches.attach(duel.id, 'bob', back, clock.t);
  alive.add('bob');
  assert.equal(back.last.phase, 'prepare');
  run(100);
  assert.equal(s.ann.last.holdMs, undefined);
  bothReady(1);
});

test('a player who stays away forfeits, and the other wins', () => {
  const s = begin();
  bothReady(0);
  answer('ann', 0, wrong(0));
  answer('bob', 0, right(0));
  drop('bob');
  run(MATCH.revealMs + MATCH.prepareMs + MATCH.absentAfterMs + MATCH.holdMs);
  assert.equal(s.ann.last.phase, 'done');
  const d = getDuel(db, duel.id);
  assert.equal(d.endReason, 'forfeit');
  assert.equal(d.forfeitSide, 'opponent');
  assert.equal(d.resultUnseenBy, 'bob', 'Bob has a result to see');
  assert.equal(pushes[0][0], 'finished');
  assert.equal(pushes[0][1], 'bob');
});

test('waiting is limited over the whole match, not only each time', () => {
  begin();
  const hold = MATCH.holdMs - 1500;
  let idx = 0;
  // Bob drops for most of a hold, twice. The third time there's nothing left.
  const dropDuringReveal = () => {
    bothReady(idx);
    answer('ann', idx, right(idx));
    answer('bob', idx, right(idx));
    idx += 1;
    drop('bob');
    run(MATCH.revealMs + 100 + MATCH.prepareMs);
  };
  for (const round of [1, 2]) {
    dropDuringReveal();
    run(hold);
    assert.equal(getDuel(db, duel.id).endReason, null, `still waiting on drop ${round}`);
    matches.attach(duel.id, 'bob', stream(), clock.t);
    alive.add('bob');
    run(100);
  }
  dropDuringReveal();
  run(4000);
  assert.equal(getDuel(db, duel.id).endReason, 'forfeit');
});

test('nobody is kept waiting on a player who dropped during a question', () => {
  begin();
  bothReady(0);
  matches.attach(duel.id, 'bob', stream(), clock.t)();
  alive.delete('bob');
  answer('ann', 0, right(0));
  assert.equal(state('ann').phase, 'answer');
  run(MATCH.absentAfterMs + 100);
  assert.equal(state('ann').phase, 'reveal');
});

test('a phone that died with its connection still open is noticed', () => {
  const s = begin();
  bothReady(0);
  alive.delete('bob');
  answer('ann', 0, right(0));
  run(MATCH.beatTimeoutMs + 1000);
  assert.equal(s.bob.ended, true);
});

test('when both disappear nobody loses', () => {
  const s = begin();
  bothReady(0);
  answer('ann', 0, right(0));
  answer('bob', 0, right(0));
  drop('ann');
  drop('bob');
  run(MATCH.revealMs + MATCH.prepareMs + MATCH.absentAfterMs + MATCH.holdMs);
  const d = getDuel(db, duel.id);
  assert.equal(d.endReason, 'abandoned');
  assert.equal(d.forfeitSide, null);
  assert.equal(d.challenger.score, null);
  assert.equal(s.ann.ended, true);
});

test('leaving on purpose loses at once, and the leaver has nothing to come back to', () => {
  const s = begin();
  playQuestion(0, wrong(0), right(0));
  matches.leave(duel.id, 'ann', clock.t);
  assert.equal(s.bob.last.phase, 'done');
  const d = getDuel(db, duel.id);
  assert.equal(d.forfeitSide, 'challenger');
  assert.equal(d.resultUnseenBy, null);
});

test('a server restart cancels the open question and the match carries on', () => {
  begin();
  playQuestion(0);
  bothReady(1);
  run(1000);
  answer('ann', 1, right(1));
  const scored = state('ann').you.score;
  const versionBefore = state('ann').v;
  build(); // a new server process on the same database
  matches.restore(clock.t);
  const s = { ann: stream(), bob: stream() };
  matches.attach(duel.id, 'ann', s.ann, clock.t);
  matches.attach(duel.id, 'bob', s.bob, clock.t);
  assert.equal(s.ann.last.phase, 'void');
  assert.equal(s.ann.last.voidReason, 'restart');
  assert.ok(s.ann.last.v > versionBefore);
  assert.equal(s.ann.last.you.score, scored);
  run(MATCH.restartWaitMs + 100);
  assert.equal(state('ann').phase, 'prepare');
  assert.equal(state('ann').idx, 2);
  for (let idx = 2; idx < 10; idx++) playQuestion(idx);
  assert.equal(state('ann').phase, 'done');
  assert.equal(getDuel(db, duel.id).endReason, 'played');
});

test('a restart between questions just goes on from there', () => {
  begin();
  playQuestion(0);
  build();
  matches.restore(clock.t);
  assert.equal(state('ann').phase, 'prepare');
  assert.equal(state('ann').idx, 1);
});

test('a restart while waiting in the lobby keeps the invitation', () => {
  build();
  matches.restore(clock.t);
  assert.equal(state('ann').phase, 'lobby');
});

test('the newest connection takes over from the older one', () => {
  const s = begin();
  const second = stream();
  matches.attach(duel.id, 'ann', second, clock.t);
  assert.equal(s.ann.ended, true);
  assert.ok(s.ann.events.some((e) => e.event === 'replaced'));
  bothReady(0);
  assert.equal(second.last.phase, 'answer');
});

test('an invitation expires', () => {
  matches.attach(duel.id, 'ann', stream(), clock.t);
  run(MATCH.lobbyMs + 100);
  assert.equal(getDuel(db, duel.id).endReason, 'expired');
});

test('an invitation survives the sender leaving to share it, and they hear when someone joins', () => {
  const s = stream();
  const close = matches.attach(duel.id, 'ann', s, clock.t);
  close();
  alive.delete('ann');
  run(60_000);
  assert.equal(getDuel(db, duel.id).endReason, null);
  matches.join(duel.id, 'bob', clock.t);
  matches.attach(duel.id, 'bob', stream(), clock.t);
  assert.equal(pushes[0][0], 'joined');
  assert.equal(pushes[0][1], 'ann');
  assert.equal(getDuel(db, duel.id).live.phase, 'lobby');
  matches.attach(duel.id, 'ann', stream(), clock.t);
  assert.equal(state('bob').phase, 'countdown');
});

test('a sender who never comes back ends the invitation', () => {
  matches.attach(duel.id, 'ann', stream(), clock.t)();
  alive.delete('ann');
  run(10_000);
  matches.join(duel.id, 'bob', clock.t);
  matches.attach(duel.id, 'bob', stream(), clock.t);
  run(MATCH.hostWaitMs + 100);
  assert.equal(getDuel(db, duel.id).endReason, 'expired');
});

test('someone who takes the seat and vanishes frees it again', () => {
  drop('ann');
  run(10_000);
  alive.delete('bob');
  matches.join(duel.id, 'bob', clock.t);
  assert.equal(getDuel(db, duel.id).opponentId, 'bob');
  run(MATCH.guestWaitMs + 100);
  assert.equal(getDuel(db, duel.id).opponentId, null);
  assert.equal(state('ann').joined, false);
});

test('the waiting time shown is what the absent player really has left', () => {
  const s = begin();
  const used = MATCH.holdMs - 2000;
  let idx = 0;
  const dropAndWait = () => {
    bothReady(idx);
    answer('ann', idx, right(idx));
    answer('bob', idx, right(idx));
    idx += 1;
    drop('bob');
    run(MATCH.revealMs + MATCH.prepareMs + 100);
  };
  for (let drops = 0; drops < 2; drops++) {
    dropAndWait();
    assert.ok(s.ann.last.holdMs <= MATCH.holdMs);
    run(used);
    matches.attach(duel.id, 'bob', stream(), clock.t);
    alive.add('bob');
    run(100);
  }
  dropAndWait();
  assert.ok(s.ann.last.holdMs > 0);
  assert.ok(s.ann.last.holdMs <= MATCH.graceMs - 2 * used + 200, 'only what is left of the allowance');
});

test('a jump in the time of day does not reach the server clock', (t) => {
  const before = serverNow();
  t.mock.method(Date, 'now', () => 0);
  const during = serverNow();
  t.mock.restoreAll();
  assert.ok(during >= before);
  assert.ok(during - before < 5000);
});

test('one live match at a time', () => {
  begin();
  upsertUser(db, { id: 'cat', name: 'cat', provider: 'dev' });
  const other = createDuel(db, { id: 'BBBBBBBB', challengerId: 'cat', category: 'mixed' });
  matches.open(other, clock.t);
  assert.throws(() => matches.join('BBBBBBBB', 'ann', clock.t), (e) => e.status === 409 && e.live === duel.id);
  assert.equal(matches.liveFor('ann'), duel.id);
});

test('nobody else can see or play a match', () => {
  begin();
  assert.throws(() => matches.state(duel.id, 'eve', clock.t), (e) => e.status === 403);
  assert.throws(() => matches.answer(duel.id, 'eve', 0, 'x', false, clock.t), (e) => e.status === 403);
  assert.throws(() => matches.join(duel.id, 'eve', clock.t), (e) => e.status === 409);
});

test('a rematch offer reaches whoever is still on the result screen', () => {
  const s = begin();
  matches.leave(duel.id, 'ann', clock.t);
  matches.offerRematch(duel.id, 'CCCCCCCC', clock.t);
  assert.equal(s.bob.last.rematch, 'CCCCCCCC');
});

test('a finished match is let go of after a while', () => {
  const s = begin();
  matches.leave(duel.id, 'ann', clock.t);
  run(MATCH.doneKeepMs + 200);
  assert.equal(matches.isOpen(duel.id), false);
  assert.equal(s.bob.ended, true);
  assert.throws(() => matches.state(duel.id, 'bob', clock.t), (e) => e.status === 404);
});
