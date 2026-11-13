// Questions taken out of shared/questions.js while players still have saved data that names them:
// Dailies already picked, rounds open on the server, answers and rounds the browser sends late.
// A removed question is simulated with a made-up id. Run with `npm test`.

import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPlay, ensureProfile, getDaily, getPlay, getStats, openDb, roundAnswers, saveRound, upsertUser } from '../server/db.js';
import { createPlays } from '../server/play.js';
import { pickQuestions, pickReplacement } from '../server/pick.js';
import { grade } from '../server/grade.js';
import { QUESTION_BY_ID } from '../shared/questions.js';

const dir = mkdtempSync(join(tmpdir(), 'smarts-removed-'));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
afterEach(() => db.close());

const GONE = 'removed-question-1';
const GONE_TOO = 'removed-question-2';
const DAY = '2026-11-13';

let file = 0;
let db;
let finished; // { play, graded, skippedMs } for each round that ended

beforeEach(() => {
  db = openDb(join(dir, `t${file++}.db`));
  finished = [];
  for (const id of ['ann', 'bob']) ensureProfile(db, upsertUser(db, { id, name: id, provider: 'dev' }));
});

const ten = (seed = 'removed') => pickQuestions({ count: 10, seed });
const bandOf = (slot) => [[0, 3], [4, 6], [7, 10]][Math.min(2, Math.floor(((slot + 0.5) / 10) * 3))];
const known = (ids) => ids.every((id) => QUESTION_BY_ID.has(id));

/** Saves a Daily as it was picked before some of its questions left the bank. */
function oldDaily(ids) {
  db.prepare('INSERT INTO daily_challenges (day, number, question_ids, created_at) VALUES (?, ?, ?, ?)').run(DAY, 7, JSON.stringify(ids), Date.now());
}
const replaceForDaily = (ids, slot, recent) => pickReplacement({ ids, slot, seed: `daily:${DAY}:${slot}`, avoid: recent });

function makePlays(replacementFor = (play, idx) => pickReplacement({ ids: play.questionIds, slot: idx, seed: `${play.kind}:${play.ref}:${idx}` })) {
  return createPlays(db, { onFinish: (play, graded, skippedMs) => finished.push({ play, graded, skippedMs }), replacementFor });
}

// ── The Daily ──

test("a Daily picked before a question left the bank gets a fitting replacement, saved for everyone", () => {
  const ids = ten();
  const slot = 8; // a hard one
  const before = [...ids];
  before[slot] = GONE;
  oldDaily(before);

  const daily = getDaily(db, DAY, 7, () => assert.fail('the Daily was already picked'), replaceForDaily);
  assert.equal(daily.questionIds.length, 10);
  assert.ok(known(daily.questionIds));
  assert.equal(new Set(daily.questionIds).size, 10, 'no question twice');
  assert.deepEqual(daily.questionIds.filter((_, i) => i !== slot), ids.filter((_, i) => i !== slot), 'the others stay where they were');
  const swapped = QUESTION_BY_ID.get(daily.questionIds[slot]);
  const [lo, hi] = bandOf(slot);
  assert.ok(swapped.difficulty >= lo && swapped.difficulty <= hi, `difficulty ${swapped.difficulty} is in ${lo}–${hi}`);

  // Saved: everyone, and every later request, gets the same.
  const row = db.prepare('SELECT question_ids FROM daily_challenges WHERE day = ?').get(DAY);
  assert.deepEqual(JSON.parse(row.question_ids), daily.questionIds);
  assert.deepEqual(getDaily(db, DAY, 7, () => [], replaceForDaily).questionIds, daily.questionIds);
});

test('a Daily with nothing to replace a removed question with leaves it out', () => {
  oldDaily([...ten().slice(0, 9), GONE]);
  const daily = getDaily(db, DAY, 7, () => [], () => null);
  assert.equal(daily.questionIds.length, 9);
  assert.ok(known(daily.questionIds));
});

test("a past Daily's result leaves out an answer to a removed question", () => {
  const ids = ten();
  const graded = [...ids.slice(0, 9), GONE].map((id) => ({ id, cat: QUESTION_BY_ID.get(id)?.cat ?? 'dogs', choice: null, correct: false, ms: 1000, points: 0 }));
  const { roundId } = saveRound(db, 'ann', { mode: 'classic', category: 'daily', graded });
  const answers = roundAnswers(db, roundId);
  assert.equal(answers.length, 9);
  assert.ok(known(answers.map((a) => a.id)));
});

// ── Rounds open on the server ──

test('an open round swaps a removed question it has not reached, and plays on', () => {
  const plays = makePlays();
  const ids = ten();
  ids[3] = GONE;
  const raw = createPlay(db, { kind: 'daily', ref: DAY, side: null, userId: 'ann', questionIds: ids });

  const play = plays.get(raw.id);
  assert.ok(known(play.questionIds), 'the removed question was swapped');
  assert.deepEqual(getPlay(db, raw.id).questionIds, play.questionIds, 'and the swap was saved');
  assert.equal(new Set(play.questionIds).size, 10);

  let t = 1_000_000;
  for (let idx = 0; idx < 10; idx++) {
    const p = plays.get(raw.id);
    const opened = plays.open(p, idx, t);
    assert.ok(opened.options.length > 1);
    const r = plays.answer(p, idx, QUESTION_BY_ID.get(p.questionIds[idx]).answer, t + 1000);
    assert.equal(r.correct, true);
    t += 5000;
  }
  assert.equal(finished.length, 1);
  assert.equal(finished[0].graded.length, 10);
  assert.ok(finished[0].graded.every((a) => a.correct));
});

test('the Daily replacement for an open round is the one everyone else now gets', () => {
  const ids = ten();
  const before = [...ids];
  before[5] = GONE;
  oldDaily(before);
  const daily = () => getDaily(db, DAY, 7, () => [], replaceForDaily);
  const plays = makePlays((play, idx) => daily().questionIds[idx]);
  const raw = createPlay(db, { kind: 'daily', ref: DAY, side: null, userId: 'ann', questionIds: before });
  assert.deepEqual(plays.get(raw.id).questionIds, daily().questionIds);
});

test('with no replacement, a removed question is skipped at no cost and not counted', () => {
  const plays = makePlays(() => null);
  const ids = ten();
  ids[0] = GONE;
  ids[9] = GONE_TOO;
  const raw = createPlay(db, { kind: 'duel', ref: 'AAAAAAAA', side: 'challenger', userId: 'ann', questionIds: ids });
  const play = plays.get(raw.id);
  assert.equal(play.idx, 1, 'the first question was skipped');
  assert.equal(plays.view(play).results[0].skipped, true);
  assert.equal(plays.counted(play), 8);

  let t = 1_000_000;
  for (let idx = 1; idx < 9; idx++) {
    plays.open(play, idx, t);
    plays.answer(play, idx, null, t + 1000);
    t += 5000;
  }
  // The last one left too: the round ends on its own when it comes up.
  assert.equal(finished.length, 1);
  const { graded, skippedMs } = finished[0];
  assert.equal(graded.length, 8);
  assert.ok(!graded.some((a) => a.id === GONE || a.id === GONE_TOO));
  assert.equal(skippedMs, 0);
});

test('a round with a removed question already answered, or opened, still works', () => {
  const plays = makePlays(() => null);
  const ids = ten();
  ids[0] = GONE;
  ids[1] = GONE_TOO;
  const raw = createPlay(db, { kind: 'quest', ref: '1:abc', side: null, userId: 'ann', questionIds: ids });
  // Answered before the deploy, and the next one opened.
  db.prepare('UPDATE plays SET idx = 1, opened_at = ?, answers = ? WHERE id = ?')
    .run(Date.now(), JSON.stringify([{ id: GONE, cat: 'dogs', choice: 'Pug', correct: true, ms: 2000, points: 3 }]), raw.id);

  const play = plays.get(raw.id);
  assert.equal(play.idx, 2, 'the opened one was skipped');
  const retry = plays.answer(play, 0, 'Pug');
  assert.equal(retry.correct, true, 'a retry of the old answer still gets its outcome');
  assert.equal(plays.pictureFile(play, 1), null);
  assert.doesNotThrow(() => plays.view(play));

  plays.finish(play);
  const { graded, skippedMs } = finished[0];
  assert.equal(graded[0].id, GONE, 'what was answered stays in the history');
  assert.equal(graded.length, 9);
  assert.equal(skippedMs, 0);
});

test('a stale round with removed questions is ended without an error', () => {
  const plays = makePlays();
  const ids = ten();
  ids[2] = GONE;
  const raw = createPlay(db, { kind: 'daily', ref: DAY, side: null, userId: 'ann', questionIds: ids });
  db.prepare('UPDATE plays SET updated_at = 0 WHERE id = ?').run(raw.id);
  plays.endStale();
  assert.equal(finished.length, 1);
  assert.equal(finished[0].graded.length, 9);
});

// ── Stats ──

test('stats ignore answers to removed questions', () => {
  const ids = ten();
  const cat = QUESTION_BY_ID.get(ids[0]).cat;
  const wrong = (id, c = QUESTION_BY_ID.get(id)?.cat ?? cat) => ({ id, cat: c, choice: 'x', correct: false, ms: 1000, points: 0 });
  const right = (id) => ({ id, cat: QUESTION_BY_ID.get(id)?.cat ?? cat, choice: QUESTION_BY_ID.get(id)?.answer ?? 'x', correct: true, ms: 1000, points: 3 });
  saveRound(db, 'ann', { mode: 'classic', category: 'mixed', graded: [wrong(GONE, cat), wrong(ids[0]), right(ids[1])] });
  saveRound(db, 'ann', { mode: 'classic', category: 'mixed', graded: [wrong(GONE, cat), right(GONE_TOO), right(ids[1])] });

  const s = getStats(db, 'ann');
  for (const list of [s.seenIds, s.knownIds, s.masteredIds, s.dueMistakes, s.lastRoundIds, s.missed.map((m) => m.id)]) {
    assert.ok(known(list), JSON.stringify(list));
  }
  assert.deepEqual(s.missed.map((m) => m.id), [ids[0]]);
  assert.deepEqual(new Set(s.seenIds), new Set([ids[0], ids[1]]));
  const topic = s.byCategory.find((c) => c.category === cat);
  const inTopic = [ids[0], ids[1]].filter((id) => QUESTION_BY_ID.get(id).cat === cat);
  assert.equal(topic.seen, inTopic.length);
  assert.equal(s.answered, 6, 'the history itself is kept');
});

// ── Rounds the browser sends ──

test('a round sent with a removed question saves the rest', () => {
  const ids = ten();
  const answers = [
    { id: ids[0], choice: QUESTION_BY_ID.get(ids[0]).answer, ms: 2000 },
    { id: GONE, choice: 'Pug', ms: 2000 },
    { id: ids[1], choice: 'nope', ms: 3000 },
  ];
  const graded = grade(answers);
  assert.deepEqual(graded.map((a) => a.id), [ids[0], ids[1]]);
  assert.equal(graded[0].correct, true);
  const saved = saveRound(db, 'ann', { mode: 'classic', category: 'mixed', graded });
  assert.equal(saved.total, 2);
});

test('a round whose questions have all been removed grades to nothing instead of failing', () => {
  assert.deepEqual(grade([{ id: GONE, choice: 'Pug', ms: 2000 }]), []);
  assert.throws(() => grade([{ id: 42 }]), { status: 400 });
  assert.throws(() => grade([]), { status: 400 });
});

test('a replacement is never a question the round already has', () => {
  const ids = ten();
  for (let slot = 0; slot < 10; slot++) {
    const id = pickReplacement({ ids, slot, seed: `s${slot}` });
    assert.ok(QUESTION_BY_ID.has(id));
    assert.ok(!ids.includes(id));
  }
});
