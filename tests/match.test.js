// Live duels, played by two simulated players against a clock the test controls.
// Run with `npm test`.

import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buyItem, coinsOf, createDuel, ensureProfile, finishDuelSide, getDaily, getDuel, grantUnlocked, openDb, ownProfile, payDuel, rescaledXp, saveProfile, saveRound, upsertUser } from '../server/db.js';
import { avatarCode, parseAvatar, unlockPrice } from '../shared/avatars.js';
import { createPlays } from '../server/play.js';
import { serverNow } from '../server/clock.js';
import { createMatches } from '../server/match.js';
import { hasEnoughQuestions, pickQuestions } from '../server/pick.js';
import { pictureKeepsSecret } from '../server/pictures.js';
import { QUESTIONS, QUESTION_BY_ID } from '../shared/questions.js';
import { COINS, MATCH, PLAY, levelFor, roundCoins, xpForLevel } from '../shared/config.js';

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
let picked; // the questions of the next match, when a test needs particular ones
let finished; // what was saved for each player

function build() {
  plays = createPlays(db, {
    onFinish: (play, graded, skippedMs, { xp }) => {
      finished[play.userId] = { graded: graded.length, xp };
      finishDuelSide(db, play.ref, play.side, {
        roundId: null, score: graded.reduce((s, a) => s + a.points, 0), correct: graded.filter((a) => a.correct).length, ms: graded.reduce((s, a) => s + a.ms, skippedMs),
      });
    },
  });
  pushes = [];
  matches = createMatches(db, {
    plays, clock: () => clock.t,
    profileOf: (id) => ({ id, name: id, avatar: null }),
    pick: () => picked ?? pickQuestions({ count: 10, category: 'mixed', seed: 'test' }),
    reminders: { duelJoined: (...a) => pushes.push(['joined', ...a]), duelFinished: (...a) => pushes.push(['finished', ...a]) },
    log: (...a) => { throw a[1] ?? new Error(a.join(' ')); },
  });
}

beforeEach(() => {
  db = openDb(join(dir, `t${file++}.db`));
  clock = { t: 1_000_000 };
  picked = null;
  finished = {};
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

const withVisual = (type) => QUESTIONS.filter((q) => q.visual.type === type).slice(0, 10).map((q) => q.id);

test('a picture only one player reports costs only that player, and only so often', () => {
  picked = withVisual('map');
  const s = begin();
  for (let idx = 0; idx < MATCH.maxVoids; idx++) {
    matches.ready(duel.id, 'bob', idx, true, clock.t);
    assert.equal(state('ann').phase, 'prepare', 'one report cancels nothing');
    matches.ready(duel.id, 'ann', idx, false, clock.t);
    assert.equal(state('ann').phase, 'answer');
    assert.equal(state('bob').noPicture, true);
    assert.equal(state('ann').noPicture, undefined);
    assert.equal(s.ann.last.them.answered, true, 'Ann is not kept waiting for Bob');
    run(1000);
    answer('bob', idx, right(idx));
    assert.equal(state('ann').phase, 'answer', 'Bob can no longer answer');
    answer('ann', idx, right(idx));
    assert.equal(state('ann').phase, 'reveal');
    assert.equal(s.ann.last.result.correct, true);
    assert.equal(s.bob.last.result.correct, false);
    assert.equal(s.bob.last.result.points, 0);
    assert.equal(s.bob.last.result.noPicture, true);
    assert.equal(s.bob.last.result.answer, right(idx));
    run(MATCH.revealMs + 100);
  }
  const idx = MATCH.maxVoids;
  matches.ready(duel.id, 'bob', idx, true, clock.t);
  matches.ready(duel.id, 'ann', idx, false, clock.t);
  assert.equal(state('bob').noPicture, undefined, 'out of reports: Bob plays it like anyone else');
  assert.equal(state('bob').you.results.filter((r) => r.skipped).length, MATCH.maxVoids);
  assert.equal(state('ann').you.results.filter((r) => r.skipped).length, 0);
});

test('a question is cancelled for both only if both report the picture', () => {
  picked = withVisual('map');
  begin();
  matches.ready(duel.id, 'bob', 0, true, clock.t);
  matches.ready(duel.id, 'ann', 0, true, clock.t);
  const v = state('ann');
  assert.equal(v.phase, 'void');
  assert.equal(v.voidReason, 'picture');
  assert.equal(v.you.results[0].skipped, true);
  assert.equal(state('bob').you.results[0].skipped, true);
});

test('a report about a question with nothing to download is not believed', () => {
  picked = withVisual('text');
  begin();
  matches.ready(duel.id, 'bob', 0, true, clock.t);
  matches.ready(duel.id, 'ann', 0, false, clock.t);
  assert.equal(state('ann').phase, 'answer');
  assert.equal(state('bob').noPicture, undefined);
  assert.equal(state('bob').answered, false);
});

test('a player who switched apps is away at once, and only coming back ends that', () => {
  const s = begin();
  bothReady(0);
  alive.delete('bob');
  matches.away(duel.id, 'bob', clock.t); // Bob's connection is still open
  answer('ann', 0, right(0));
  run(100);
  assert.equal(s.ann.last.phase, 'reveal', 'Ann is not kept waiting');
  assert.equal(s.ann.last.them.connected, false);
  run(MATCH.revealMs + 100);
  state('bob'); // a hidden page can still poll
  run(100);
  assert.equal(state('ann').them.connected, false, 'polling is not being back');
  assert.ok(state('ann').holdMs === undefined || state('ann').holdMs > 0);
  matches.beat(duel.id, 'bob', clock.t);
  alive.add('bob');
  run(100);
  assert.equal(state('ann').them.connected, true);
});

test('a player who stays in another app forfeits', () => {
  begin();
  alive.delete('bob');
  matches.away(duel.id, 'bob', clock.t);
  run(MATCH.prepareMs + MATCH.holdMs + 200);
  const d = getDuel(db, duel.id);
  assert.equal(d.endReason, 'forfeit');
  assert.equal(d.forfeitSide, 'opponent');
  assert.equal(d.resultUnseenBy, 'bob');
});

test('a sender who left to share the link hears when someone joins and has a minute to return', () => {
  matches.attach(duel.id, 'ann', stream(), clock.t);
  alive.delete('ann');
  matches.away(duel.id, 'ann', clock.t);
  matches.join(duel.id, 'bob', clock.t);
  matches.attach(duel.id, 'bob', stream(), clock.t);
  assert.equal(pushes[0][0], 'joined');
  run(MATCH.hostWaitMs - 1000);
  assert.equal(state('bob').phase, 'lobby');
  matches.beat(duel.id, 'ann', clock.t);
  run(100);
  assert.equal(state('bob').phase, 'countdown');
});

test('no measurement of the connection means no allowance', () => {
  const s = begin();
  bothReady(0);
  run(2000);
  answer('ann', 0, right(0));
  answer('bob', 0, right(0));
  assert.equal(s.ann.last.result.ms, 2000);
});

test('the allowance is the fastest delay measured in the match', () => {
  const s = begin();
  const withDelay = (idx, delay) => {
    bothReady(idx);
    run(delay);
    matches.seen(duel.id, 'ann', idx, clock.t);
    run(2000 - delay);
    answer('ann', idx, right(idx));
    answer('bob', idx, right(idx));
    return s.ann.last.result.ms;
  };
  assert.equal(withDelay(0, 100), 2000 - 100);
  run(MATCH.revealMs + 100);
  assert.equal(withDelay(1, 900), 2000 - 100, 'a late "got it" gains nothing');
});

test('rounds record when they were last touched by the time of day', () => {
  begin(); // this test's clock is far from the time of day
  bothReady(0);
  answer('ann', 0, right(0));
  answer('bob', 0, right(0));
  assert.ok(Math.abs(plays.find('duel', duel.id, 'ann').updatedAt - Date.now()) < 60_000);
  plays.endStale();
  assert.equal(plays.find('duel', duel.id, 'ann').finishedAt, null, 'a round being played is not stale');
});

test('a forfeit saves only what was played, and the player who left earns nothing', () => {
  begin();
  for (let idx = 0; idx < 5; idx++) playQuestion(idx);
  matches.leave(duel.id, 'ann', clock.t);
  assert.deepEqual(finished.bob, { graded: 5, xp: true });
  assert.deepEqual(finished.ann, { graded: 5, xp: false });
});

test('winning by forfeit early on earns no XP', () => {
  begin();
  for (let idx = 0; idx < 4; idx++) playQuestion(idx);
  matches.leave(duel.id, 'ann', clock.t);
  assert.deepEqual(finished.bob, { graded: 4, xp: false });
});

test('a duel played to the end earns both players their XP', () => {
  begin();
  for (let idx = 0; idx < 10; idx++) playQuestion(idx);
  assert.deepEqual(finished.ann, { graded: 10, xp: true });
  assert.deepEqual(finished.bob, { graded: 10, xp: true });
});

test('no question whose picture would give away its answer is ever picked', () => {
  for (let i = 0; i < 40; i++) {
    for (const category of ['mixed', 'clubs', 'flags', 'countries']) {
      for (const id of pickQuestions({ count: 10, category, seed: `${category}${i}` })) assert.ok(pictureKeepsSecret(QUESTION_BY_ID.get(id)), id);
    }
  }
});

test('levels cost more, but one finished round still reaches level 2', () => {
  assert.equal(levelFor(9), 1);
  assert.equal(levelFor(10), 2);
  for (let level = 2; level < 99; level++) {
    assert.equal(levelFor(xpForLevel(level)), level);
    assert.equal(levelFor(xpForLevel(level) - 1), level - 1);
  }
  assert.equal(xpForLevel(50), 29_386);
});

test('moving to the costlier levels keeps every player on their level', () => {
  const oldLevel = (xp) => Math.min(99, Math.floor((1 + Math.sqrt(1 + (4 * xp) / 5)) / 2));
  for (const xp of [0, 1, 9, 10, 29, 30, 99, 100, 451, 1900, 12_250, 48_509, 48_510, 60_000]) assert.equal(levelFor(rescaledXp(xp)), oldLevel(xp), `xp ${xp}`);
});

// ── Coins ──
const graded = (points) => [{ id: QUESTIONS[0].id, cat: QUESTIONS[0].cat, choice: 'x', correct: points > 0, ms: 1000, points }];
const playRound = (id, points, category = 'mixed', complete = true) => saveRound(db, id, { mode: 'classic', category, graded: graded(points), complete });
const give = (id, xp, coins) => db.prepare('UPDATE profiles SET xp = ?, coins = ? WHERE user_id = ?').run(xp, coins, id);
const account = (id) => ensureProfile(db, { id, name: id });

test('a round pays its score plus the finish bonus, and nothing for no points', () => {
  account('ann');
  assert.equal(roundCoins('mixed', 0), 0);
  assert.equal(playRound('ann', 12).coinsGained, 12 + COINS.finished + COINS.levelUp); // this round also reaches level 2
  assert.equal(playRound('ann', 3, 'daily').coinsGained, 3 + COINS.finished + COINS.bonus.daily);
  const before = coinsOf(db, 'ann');
  assert.equal(playRound('ann', 5, 'mixed', false).coinsGained, 0, 'a round left unfinished pays nothing');
  assert.equal(coinsOf(db, 'ann'), before);
});

test('Quick rounds pay half after the daily limit, and the Daily does not', () => {
  account('ann');
  give('ann', 1_000_000, 0);
  for (let i = 0; i < COINS.quickFullPerDay; i++) assert.equal(playRound('ann', 10).coinsGained, 15);
  assert.equal(playRound('ann', 10).coinsGained, 8);
  assert.equal(playRound('ann', 10, 'daily').coinsGained, 10 + COINS.finished + COINS.bonus.daily);
});

test('each level pays once', () => {
  account('ann');
  give('ann', xpForLevel(3) - 1, 0);
  assert.equal(playRound('ann', 10).coinsGained, 15 + COINS.levelUp);
  give('ann', xpForLevel(3) - 1, 0); // back below level 3
  assert.equal(playRound('ann', 10).coinsGained, 15);
});

test('prices follow the level, skins cost more, free things stay free', () => {
  assert.equal(unlockPrice('eyes', 'angry'), 50); // level 2
  assert.equal(unlockPrice('extra', 'ascended'), 630); // level 50
  assert.equal(unlockPrice('animal', 'dragon'), 950); // a skin at level 50
  assert.equal(unlockPrice('animal', 'cat'), 0);
});

test('an item must be unlocked and paid for, and is only charged once', () => {
  account('ann');
  give('ann', 0, 1000);
  assert.throws(() => buyItem(db, 'ann', 'eyes', 'angry'), /level 2/);
  give('ann', xpForLevel(2), 40);
  assert.throws(() => buyItem(db, 'ann', 'eyes', 'angry'), (e) => e.code === 'notEnoughCoins');
  assert.equal(coinsOf(db, 'ann'), 40);
  give('ann', xpForLevel(2), 120);
  assert.equal(buyItem(db, 'ann', 'eyes', 'angry').coins, 70);
  assert.equal(buyItem(db, 'ann', 'eyes', 'angry').coins, 70, 'buying twice costs nothing');
  assert.deepEqual(ownProfile(db, ensureProfile(db, { id: 'ann', name: 'ann' })).owned, ['eyes:angry']);
  assert.throws(() => buyItem(db, 'ann', 'animal', 'cat'), /free/);
  assert.throws(() => buyItem(db, 'ann', 'nonsense', 'x'), /free/);
});

test('an avatar part can only be worn once it is bought', () => {
  const p = account('ann');
  give('ann', xpForLevel(2), 100);
  const avatar = avatarCode({ ...parseAvatar(p.avatar), eyes: 'angry' });
  assert.throws(() => saveProfile(db, 'ann', { avatar }), /Buy/);
  buyItem(db, 'ann', 'eyes', 'angry');
  assert.equal(saveProfile(db, 'ann', { avatar }).avatar, avatar);
});

test('existing players keep everything they had unlocked, for free', () => {
  const p = account('ann');
  grantUnlocked(db, 'ann', xpForLevel(3), p.avatar);
  const { owned, coins } = ownProfile(db, p);
  for (const item of ['eyes:angry', 'extra:tribal', 'animal:wolf']) assert.ok(owned.includes(item), item);
  assert.ok(!owned.includes('bg:crimson'), 'level 4 is not reached yet');
  assert.equal(coins, 0);
});

test('a played duel pays the winner more, and pays once', () => {
  account('ann');
  account('bob');
  begin();
  for (let idx = 0; idx < 10; idx++) playQuestion(idx);
  assert.equal(coinsOf(db, 'ann'), COINS.duel.win);
  assert.equal(coinsOf(db, 'bob'), COINS.duel.loss);
  payDuel(db, duel.id);
  assert.equal(coinsOf(db, 'ann'), COINS.duel.win);
});

test('whoever gives up gets no duel coins, and an early forfeit pays the winner nothing', () => {
  account('ann');
  account('bob');
  begin();
  for (let idx = 0; idx < 5; idx++) playQuestion(idx);
  matches.leave(duel.id, 'ann', clock.t);
  assert.equal(coinsOf(db, 'ann'), 0);
  assert.equal(coinsOf(db, 'bob'), COINS.duel.win);
});

test('winning by a very early forfeit pays nothing', () => {
  account('ann');
  account('bob');
  begin();
  playQuestion(0);
  matches.leave(duel.id, 'ann', clock.t);
  assert.equal(coinsOf(db, 'bob'), 0);
});

test('a Daily picked before a question was removed plays without it', () => {
  const real = QUESTIONS[0].id;
  assert.deepEqual(getDaily(db, '2026-11-09', 9, () => ['removed-question', real]).questionIds, [real]);
});

test('a topic with too few safe questions is not available', () => {
  const safe = QUESTIONS.filter((q) => q.cat === 'clubs' && pictureKeepsSecret(q)).length;
  assert.equal(hasEnoughQuestions('clubs', 10), safe >= 10);
  assert.equal(hasEnoughQuestions('mixed', 10), true);
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
