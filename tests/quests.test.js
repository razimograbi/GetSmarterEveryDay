// The Levels (server/quests.js): rounds that end at the first wrong answer, and what they pay.
// Run with `npm test`.

import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { addFriend, ensureProfile, finishQuestTry, friendsFirstTry, getProfile, openDb, openQuestPlay, questResults, upsertUser } from '../server/db.js';
import { createPlays } from '../server/play.js';
import { QUESTS, questProblems, questQuestions } from '../server/quests.js';
import { QUESTION_BY_ID } from '../shared/questions.js';
import { PLAY, QUEST, questConsolation, questPrize, secondsFor } from '../shared/config.js';

const dir = mkdtempSync(join(tmpdir(), 'smarts-quests-'));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
afterEach(() => db.close());

let file = 0;
let db;
let plays;
let saved; // what each finished try was saved as
let now;

const LEVEL = QUESTS[0];
const answerOf = (id) => QUESTION_BY_ID.get(id).answer;
const wrongOf = (id) => QUESTION_BY_ID.get(id).wrong[0];

beforeEach(() => {
  db = openDb(join(dir, `t${file++}.db`));
  now = 5_000_000;
  saved = [];
  for (const id of ['ann', 'bob']) ensureProfile(db, upsertUser(db, { id, name: id, provider: 'dev' }));
  plays = createPlays(db, {
    endsOnMiss: (play) => play.kind === 'quest',
    onFinish: (play, graded) => saved.push(finishQuestTry(db, { userId: play.userId, questId: Number(play.ref.split(':')[0]), mode: 'classic', graded, total: play.questionIds.length })),
  });
});

const begin = (userId = 'ann', level = LEVEL) => plays.begin({ kind: 'quest', ref: `${level.id}:${randomUUID()}`, userId, questionIds: level.questions });

/** Opens the current question and answers it a second later. */
function answer(play, choice) {
  const idx = play.idx;
  plays.open(play, idx, now);
  now += 1000;
  return plays.answer(play, idx, choice, now);
}

/** Answers right until `stopAt` questions are solved. */
function solve(play, stopAt = play.questionIds.length) {
  let last = null;
  while (play.idx < stopAt) last = answer(play, answerOf(play.questionIds[play.idx]));
  return last;
}

test('the levels are written correctly: real questions of their topic, none in two levels', () => {
  assert.deepEqual(questProblems(), []);
  assert.equal(QUESTS.length, 10);
  const all = QUESTS.flatMap((l) => l.questions);
  assert.equal(new Set(all).size, all.length);
  assert.ok(QUESTS.every((l) => l.questions.length >= 5 && l.questions.length <= 30));
});

test('the first levels use only the easiest questions and end on medium ones', () => {
  for (const level of QUESTS.slice(0, 2)) {
    const ratings = level.questions.map((id) => QUESTION_BY_ID.get(id).difficulty);
    const easy = ratings.findIndex((d) => d > 1);
    assert.ok(easy > 0 && ratings.slice(easy).every((d) => d >= 4 && d <= 6), `level ${level.id}: ${ratings}`);
  }
});

test('a level leaves out a question whose picture would name the answer', () => {
  assert.deepEqual(questQuestions(LEVEL, () => true), LEVEL.questions);
  assert.deepEqual(questQuestions(LEVEL, (q) => q.id !== LEVEL.questions[1]), LEVEL.questions.filter((id) => id !== LEVEL.questions[1]));
});

test('a wrong answer ends the try, and only the questions reached are saved', () => {
  const play = begin();
  solve(play, 2);
  const miss = answer(play, wrongOf(play.questionIds[2]));
  assert.equal(miss.correct, false);
  assert.equal(miss.finished, true);
  assert.equal(miss.answer, answerOf(play.questionIds[2])); // the question that ended it shows its answer
  assert.throws(() => plays.open(plays.get(play.id), 3, now), { ended: true }); // nothing after it can be opened
  assert.equal(saved.length, 1);
  assert.equal(saved[0].round.total, 3);
  assert.deepEqual({ solved: saved[0].solved, completed: saved[0].completed, firstTry: saved[0].firstTry }, { solved: 2, completed: false, firstTry: false });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM answers WHERE user_id = ?').get('ann').n, 3);
});

test('a try that ends early pays less than the number of questions solved', () => {
  const play = begin();
  solve(play, 3);
  answer(play, wrongOf(play.questionIds[3]));
  const r = saved[0];
  assert.equal(r.xp, questConsolation(3));
  assert.ok(r.xp < 3 && r.coins < 3);
  assert.equal(getProfile(db, 'ann').xp, r.xp);
  assert.equal(db.prepare("SELECT amount FROM coin_ledger WHERE user_id = 'ann' AND ref = ?").get(`round:${r.round.roundId}`).amount, r.coins);
});

test('running out of time ends the try', () => {
  const play = begin();
  plays.open(play, 0, now);
  now += secondsFor(QUESTION_BY_ID.get(play.questionIds[0])) * 1000 + PLAY.lateAllowanceMs + 1;
  const late = plays.answer(play, 0, answerOf(play.questionIds[0]), now); // right, but too late
  assert.equal(late.correct, false);
  assert.equal(late.finished, true);
  assert.equal(saved[0].completed, false);
});

test('leaving ends the try: the question on screen counts as wrong, the rest were never seen', () => {
  const play = begin();
  solve(play, 2);
  plays.open(play, 2, now);
  assert.equal(plays.finish(plays.get(play.id)), true);
  assert.equal(saved[0].round.total, 3);
  assert.equal(saved[0].solved, 2);
  assert.equal(questResults(db, 'ann').get(LEVEL.id).attempts, 1);
  assert.equal(openQuestPlay(db, LEVEL.id, 'ann'), null);
});

test('a try that saw no question is not a try', () => {
  const play = begin();
  plays.finish(play);
  assert.equal(saved[0].round, null);
  assert.equal(questResults(db, 'ann').has(LEVEL.id), false);
  // The first try is still ahead, so finishing now still doubles the prize.
  solve(begin());
  assert.equal(saved[1].firstTry, true);
});

test('questions of a level cannot be skipped', () => {
  const play = begin();
  assert.throws(() => plays.skip(play, 0), /cannot be skipped/);
  assert.equal(play.idx, 0);
});

test('finishing on the first try doubles the prize', () => {
  const play = begin();
  const last = solve(play);
  assert.equal(last.finished, true);
  const r = saved[0];
  const total = LEVEL.questions.length;
  assert.deepEqual({ completed: r.completed, firstTry: r.firstTry }, { completed: true, firstTry: true });
  assert.deepEqual({ xp: r.xp, coins: r.coins }, questPrize(total, true));
  assert.equal(r.xp, questPrize(total).xp * QUEST.firstTry);
  assert.equal(getProfile(db, 'ann').xp, r.xp);
  const mine = questResults(db, 'ann').get(LEVEL.id);
  assert.equal(mine.firstTry, true);
  assert.equal(mine.best, total);
  assert.equal(mine.last.at, mine.completedAt);
});

test('finishing after a failed try pays the plain prize', () => {
  answer(begin(), wrongOf(LEVEL.questions[0]));
  solve(begin());
  const r = saved[1];
  assert.deepEqual({ completed: r.completed, firstTry: r.firstTry }, { completed: true, firstTry: false });
  assert.deepEqual({ xp: r.xp, coins: r.coins }, questPrize(LEVEL.questions.length));
  const mine = questResults(db, 'ann').get(LEVEL.id);
  assert.equal(mine.attempts, 2);
  assert.equal(mine.firstTry, false);
});

test('a finished level never pays again', () => {
  solve(begin());
  const xp = getProfile(db, 'ann').xp;
  solve(begin()); // the server refuses to start this one; even if it ran, it earns nothing
  assert.deepEqual({ completed: saved[1].completed, xp: saved[1].xp, coins: saved[1].coins }, { completed: false, xp: 0, coins: 0 });
  assert.equal(getProfile(db, 'ann').xp, xp);
  assert.equal(questResults(db, 'ann').get(LEVEL.id).firstTry, true);
});

test('a level shows which friends finished it on their first try', () => {
  addFriend(db, 'ann', 'bob');
  solve(begin('bob'));
  answer(begin('bob', QUESTS[1]), wrongOf(QUESTS[1].questions[0])); // failed first: finishing later is no first try
  solve(begin('bob', QUESTS[1]));
  const aced = friendsFirstTry(db, 'ann');
  assert.deepEqual(aced.get(LEVEL.id).map((p) => p.id), ['bob']);
  assert.equal(aced.has(QUESTS[1].id), false);
  assert.equal(friendsFirstTry(db, 'bob').size, 0); // ann hasn't played
});
