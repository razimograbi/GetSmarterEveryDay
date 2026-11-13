// Daily, duel, Leveling and Levels rounds, played on the server, because other players see the results.
// In a duel, server/match.js opens and grades the questions of both players together.
//
// The browser asks to open one question at a time, and only then gets its text and options. The
// server starts that question's clock when it opens it, grades the answer when it arrives and
// keeps the score. Nothing the browser reports about time or correctness is believed, and a
// round can only be played forward, once: there's nothing to replay or to finish from a copy.

import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { closePlay, createPlay, findPlay, getPlay, openPlayQuestion, recordPlayAnswer, replacePlayQuestions, stalePlays } from './db.js';
import { questionContent, sortedOptions } from './bank.js';
import { QUESTION_BY_ID } from '../shared/questions.js';
import { serverNow } from './clock.js';
import { PLAY, pointsFor, secondsFor } from '../shared/config.js';
import { signSvg } from '../public/js/signs.js';
import { PUBLIC, localPicture } from './pictures.js';

// Pictures that take a while to download are sent ahead, without the question's words.
const DOWNLOADED = new Set(['wiki', 'flag', 'country', 'image', 'map']);

const conflict = (message, extra = {}) => Object.assign(new Error(message), { status: 409, ...extra });

/** Stands in for a question answered in a round and taken out of the bank since. */
const removedQuestion = (a) => ({ id: a.id, cat: a.cat ?? null, prompt: '', visual: { type: 'text' }, options: [], answer: '', removed: true });

/**
 * `endsOnMiss(play)` says whether a round is over at its first wrong answer (the Levels). Such a
 * round never counts a question the player didn't reach, and its questions can't be skipped.
 *
 * A question can be taken out of the bank while a round that has it is open (it was saved before
 * a deploy). `replacementFor(play, idx)` names one to play in its place, and `onMend(play)` hears
 * that a round's questions changed. The browser only knows a round's questions as numbered slots,
 * so the swap goes unnoticed. With no replacement, the question is skipped at no cost.
 */
export function createPlays(db, { onFinish, endsOnMiss = () => false, replacementFor = () => null, onMend = () => {} }) {
  // A Leveling round carries its own copy of its questions (they're written on the admin
  // dashboard and can change or go away while someone is playing). The others use the bank.
  const questionOf = (play, id) => play.content?.[id] ?? QUESTION_BY_ID.get(id);
  const questionAt = (play, idx) => questionOf(play, play.questionIds[idx]);
  const exists = (play, idx) => !!questionAt(play, idx);

  /**
   * Swaps the questions not answered yet that are no longer in the bank, then skips the current
   * one if it still is (it scores nothing, costs no time and isn't counted). Returns the play.
   */
  function mend(play) {
    if (!play || play.finishedAt) return play;
    let swapped = false;
    for (let idx = play.idx; idx < play.questionIds.length; idx++) {
      if (exists(play, idx)) continue;
      const id = replacementFor(play, idx);
      if (id && QUESTION_BY_ID.has(id) && !play.questionIds.includes(id)) {
        play.questionIds[idx] = id;
        swapped = true;
      }
    }
    if (swapped) {
      replacePlayQuestions(db, play.id, play.questionIds);
      onMend(play);
    }
    let skippedAny = false;
    while (play.idx < play.questionIds.length && !exists(play, play.idx)) {
      play.answers.push({ id: play.questionIds[play.idx], cat: null, skipped: true, removed: true, correct: false, points: 0 });
      play.idx += 1;
      play.openedAt = null;
      skippedAny = true;
    }
    if (skippedAny) {
      recordPlayAnswer(db, play.id, play.idx, play.answers);
      if (play.idx >= play.questionIds.length) finish(play);
    }
    return play;
  }

  /** How many questions a round counts: not the ones that left the bank before they were played. */
  const counted = (play) =>
    play.questionIds.length
    - play.answers.filter((a) => a.removed).length
    - play.questionIds.slice(play.answers.length).filter((id) => !questionOf(play, id)).length;

  /** A question's picture as the player's browser may see it: no Wikipedia title, flag code or sign name. */
  function visualFor(play, idx) {
    const q = questionAt(play, idx);
    const v = q.visual;
    const src = localPicture(q) ? `/pic/${play.id}/${idx}` : null;
    switch (v.type) {
      case 'wiki': return src ? { type: 'wiki', src, logo: v.logo, hide: v.hide } : v;
      case 'flag': return src ? { type: 'flag', src } : v;
      case 'country': return src ? { type: 'country', src } : v;
      case 'image': return { type: 'image', src: v.src, alt: v.alt };
      case 'sign': return { type: 'sign', svg: signSvg(v.id) };
      default: return v;
    }
  }

  /** Pictures of this question and the next ones, for the browser to download while there's time. */
  function previews(play) {
    const list = [];
    for (let idx = play.idx; idx < Math.min(play.questionIds.length, play.idx + PLAY.lookahead + 1); idx++) {
      if (exists(play, idx) && DOWNLOADED.has(questionAt(play, idx).visual.type)) list.push({ idx, visual: visualFor(play, idx) });
    }
    return list;
  }

  /** What the browser may know about a question before its words appear. */
  const peek = (play, idx) => ({ cat: questionAt(play, idx).cat, visual: visualFor(play, idx) });

  /** Whether this question has a picture to download, which is the only thing that can fail to load. */
  const downloads = (play, idx) => DOWNLOADED.has(questionAt(play, idx).visual.type);

  /** Where a round stands, for the browser that plays it. */
  function view(play) {
    return {
      id: play.id,
      total: play.questionIds.length,
      idx: play.idx,
      results: play.answers.map(({ correct, points, skipped }) => ({ correct, points, skipped })),
      previews: previews(play),
    };
  }

  /** Starts `userId`'s one go at this round, or returns the one already started. */
  function begin({ kind, ref, side = null, userId, questionIds, content = null }) {
    return mend(findPlay(db, kind, ref, userId)) ?? createPlay(db, { kind, ref, side, userId, questionIds, content });
  }

  /**
   * Ends a round: every question not reached is wrong, at full time. Does nothing if it has ended.
   * For a duel cut short by a forfeit, `playedOnly` leaves out what nobody got to play and `xp`
   * says whether it earns any.
   */
  function finish(play, { playedOnly = false, xp = true } = {}) {
    if (!closePlay(db, play.id)) return false;
    const skipped = play.answers.filter((a) => a.skipped);
    const graded = play.answers.filter((a) => !a.skipped);
    // What counts as wrong: everything left, or nothing (a forfeited duel), or in a round that
    // ends on a miss only the question that was on screen, since the others were never seen.
    const open = play.openedAt !== null && play.answers.length < play.questionIds.length ? 1 : 0;
    const reached = endsOnMiss(play) ? play.answers.length + open : playedOnly ? play.answers.length : play.questionIds.length;
    for (const id of play.questionIds.slice(play.answers.length, reached)) {
      const q = questionOf(play, id);
      if (!q) continue; // no longer in the bank: not counted
      graded.push({ id, cat: q.cat, choice: null, correct: false, ms: secondsFor(q) * 1000, points: 0 });
    }
    // A question skipped because its picture failed scores nothing and is left out of the answers,
    // but costs its full time: skipping the hard ones must not win ties. One skipped because it
    // left the bank costs nothing.
    const skippedMs = skipped.filter((a) => !a.removed)
      .reduce((sum, a) => sum + secondsFor(questionOf(play, a.id) ?? { cat: a.cat }) * 1000, 0);
    onFinish(play, graded, skippedMs, { xp });
    return true;
  }

  /** Closes a round without counting it, for a duel nobody finished. */
  const abandon = (play) => closePlay(db, play.id);

  /** Starts the current question's clock (once: asking again doesn't restart it) and gives its words. */
  function open(play, idx, now = serverNow()) {
    if (play.finishedAt) throw conflict('This round has ended.', { ended: true });
    if (idx !== play.idx) throw conflict('That is not the current question.');
    const q = questionAt(play, idx);
    if (play.openedAt === null) {
      openPlayQuestion(db, play.id, idx, now);
      play.openedAt = now;
    }
    const seconds = secondsFor(q);
    const options = sortedOptions(q)
      .map((option) => [createHash('sha256').update(`${play.id}:${idx}:${option}`).digest('hex'), option])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([, option]) => option);
    return { idx, cat: q.cat, prompt: q.prompt, options, seconds, remainingMs: Math.max(0, seconds * 1000 - (now - play.openedAt)), visual: visualFor(play, idx) };
  }

  /** What the browser is told once a question is over. */
  function outcome(play, idx, a) {
    const q = questionOf(play, a.id);
    return {
      idx, correct: a.correct, points: a.points, ms: a.ms, answer: q?.answer ?? '', question: q ? questionContent(q) : removedQuestion(a),
      finished: !!play.finishedAt || play.idx >= play.questionIds.length, previews: previews(play),
    };
  }

  /**
   * Grades the player's choice, timed by the server. `choice: null` gives up on the question.
   * `allowanceMs` is taken off the measured time for the trip to the player and back.
   */
  function answer(play, idx, choice, now = serverNow(), allowanceMs = PLAY.networkAllowanceMs) {
    if (idx < play.idx && play.answers[idx] && !play.answers[idx].skipped) return outcome(play, idx, play.answers[idx]); // a retry after a lost reply
    if (play.finishedAt) throw conflict('This round has ended.', { ended: true });
    if (idx !== play.idx || play.openedAt === null) throw conflict('That question has not been opened.');
    const q = questionAt(play, idx);
    const seconds = secondsFor(q);
    const limitMs = seconds * 1000;
    const elapsed = now - play.openedAt;
    const inTime = elapsed <= limitMs + PLAY.lateAllowanceMs;
    const given = inTime && sortedOptions(q).includes(choice) ? choice : null;
    const correct = given === q.answer;
    const ms = given === null ? limitMs : Math.min(limitMs, Math.max(0, elapsed - allowanceMs));
    const a = { id: q.id, cat: q.cat, choice: given, correct, ms, points: pointsFor(correct, ms, seconds) };
    play.answers.push(a);
    play.idx += 1;
    play.openedAt = null;
    recordPlayAnswer(db, play.id, play.idx, play.answers);
    if (play.idx >= play.questionIds.length) finish(play);
    else if (!correct && endsOnMiss(play)) {
      finish(play);
      play.finishedAt ??= Date.now(); // so the reply says the round is over
    } else mend(play); // the next question may have left the bank
    return outcome(play, idx, a);
  }

  /**
   * A question whose picture never arrived. It can only be skipped before it's opened, so seeing
   * a question can't be undone, and it says nothing about the answer. `force` cancels one that
   * is open, for a duel question the server lost when it restarted.
   */
  function skip(play, idx, { force = false } = {}) {
    if (idx < play.idx && play.answers[idx]?.skipped) return skipped(play, idx);
    if (play.finishedAt) throw conflict('This round has ended.', { ended: true });
    if (endsOnMiss(play) && !force) throw conflict('Questions of a level cannot be skipped.'); // or a hard one could be skipped by blocking its picture
    if (idx !== play.idx || (play.openedAt !== null && !force)) throw conflict('That question can no longer be skipped.');
    const q = questionAt(play, idx);
    play.answers.push({ id: q.id, cat: q.cat, skipped: true, correct: false, points: 0 });
    play.idx += 1;
    play.openedAt = null;
    recordPlayAnswer(db, play.id, play.idx, play.answers);
    if (play.idx >= play.questionIds.length) finish(play);
    else mend(play);
    return skipped(play, idx);
  }

  function skipped(play, idx) {
    const q = questionAt(play, idx) ?? removedQuestion(play.answers[idx] ?? { id: play.questionIds[idx] });
    return { idx, question: { id: q.id, cat: q.cat, prompt: q.prompt, visual: q.visual }, finished: !!play.finishedAt || play.idx >= play.questionIds.length, previews: previews(play) };
  }

  /** The file of a picture this player may download now. */
  function pictureFile(play, idx) {
    if (play.finishedAt || !Number.isInteger(idx) || idx < play.idx || idx > play.idx + PLAY.lookahead) return null;
    const q = questionAt(play, idx);
    const path = q && localPicture(q);
    return path ? join(PUBLIC, path) : null;
  }

  /** Ends rounds nobody has touched for a while (the phone died, or the player never came back). */
  function endStale(now = Date.now()) {
    for (const play of stalePlays(db, now - PLAY.idleMs)) {
      try {
        finish(play);
      } catch (err) {
        console.error(`Could not end round ${play.id}:`, err); // this runs on a timer: an error here must not stop the server
      }
    }
  }

  return {
    get: (id) => mend(getPlay(db, id)), find: (kind, ref, userId) => mend(findPlay(db, kind, ref, userId)), mend, counted,
    begin, view, previews, peek, downloads, open, answer, skip, finish, abandon, pictureFile, endStale,
    result: (play, idx) => outcome(play, idx, play.answers[idx]),
  };
}
