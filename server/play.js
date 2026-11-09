// Daily, duel and Leveling rounds, played on the server, because other players see the results.
// In a duel, server/match.js opens and grades the questions of both players together.
//
// The browser asks to open one question at a time, and only then gets its text and options. The
// server starts that question's clock when it opens it, grades the answer when it arrives and
// keeps the score. Nothing the browser reports about time or correctness is believed, and a
// round can only be played forward, once: there's nothing to replay or to finish from a copy.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { closePlay, createPlay, findPlay, getPlay, openPlayQuestion, recordPlayAnswer, stalePlays } from './db.js';
import { questionContent, sortedOptions } from './bank.js';
import { QUESTION_BY_ID } from '../shared/questions.js';
import { serverNow } from './clock.js';
import { PLAY, pointsFor, secondsFor } from '../shared/config.js';
import { signSvg } from '../public/js/signs.js';

const PUBLIC = join(resolve(import.meta.dirname, '..'), 'public');

// The pictures kept on this server (`npm run fetch-images`). Those are served at an address that
// says nothing about them; a picture only available from elsewhere has to keep its real address.
let manifest = {};
try { manifest = JSON.parse(readFileSync(join(PUBLIC, 'img', 'manifest.json'), 'utf8')); } catch { /* no local pictures */ }
const localFlags = new Set(manifest.flags || []);
const localCountries = new Set(manifest.countries || []);

function localPicture(q) {
  const v = q.visual;
  if (v.type === 'wiki') return manifest.photos?.[q.id]?.src ?? null;
  if (v.type === 'flag') return localFlags.has(v.code) ? `/img/flags/${v.code}.png` : null;
  if (v.type === 'country') return localCountries.has(v.iso) ? `/img/countries/${v.iso}.svg` : null;
  return null;
}

// Pictures that take a while to download are sent ahead, without the question's words.
const DOWNLOADED = new Set(['wiki', 'flag', 'country', 'image', 'map']);

const conflict = (message, extra = {}) => Object.assign(new Error(message), { status: 409, ...extra });

export function createPlays(db, { onFinish }) {
  // A Leveling round carries its own copy of its questions (they're written on the admin
  // dashboard and can change or go away while someone is playing). The others use the bank.
  const questionOf = (play, id) => play.content?.[id] ?? QUESTION_BY_ID.get(id);
  const questionAt = (play, idx) => questionOf(play, play.questionIds[idx]);

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
      if (DOWNLOADED.has(questionAt(play, idx).visual.type)) list.push({ idx, visual: visualFor(play, idx) });
    }
    return list;
  }

  /** What the browser may know about a question before its words appear. */
  const peek = (play, idx) => ({ cat: questionAt(play, idx).cat, visual: visualFor(play, idx) });

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
    return findPlay(db, kind, ref, userId) ?? createPlay(db, { kind, ref, side, userId, questionIds, content });
  }

  /** Ends a round: every question not reached is wrong, at full time. Does nothing if it has ended. */
  function finish(play) {
    if (!closePlay(db, play.id)) return false;
    const skipped = play.answers.filter((a) => a.skipped);
    const graded = play.answers.filter((a) => !a.skipped);
    for (const id of play.questionIds.slice(play.answers.length)) {
      const q = questionOf(play, id);
      graded.push({ id, cat: q.cat, choice: null, correct: false, ms: secondsFor(q) * 1000, points: 0 });
    }
    // A question skipped because its picture failed scores nothing and is left out of the answers,
    // but costs its full time: skipping the hard ones must not win ties.
    const skippedMs = skipped.reduce((sum, a) => sum + secondsFor(questionOf(play, a.id)) * 1000, 0);
    onFinish(play, graded, skippedMs);
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
      idx, correct: a.correct, points: a.points, ms: a.ms, answer: q.answer, question: questionContent(q),
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
    recordPlayAnswer(db, play.id, play.idx, play.answers, now);
    if (play.idx >= play.questionIds.length) finish(play);
    return outcome(play, idx, a);
  }

  /**
   * A question whose picture never arrived. It can only be skipped before it's opened, so seeing
   * a question can't be undone, and it says nothing about the answer. `force` cancels one that
   * is open, for a duel question the server lost when it restarted.
   */
  function skip(play, idx, now = serverNow(), { force = false } = {}) {
    if (idx < play.idx && play.answers[idx]?.skipped) return skipped(play, idx);
    if (play.finishedAt) throw conflict('This round has ended.', { ended: true });
    if (idx !== play.idx || (play.openedAt !== null && !force)) throw conflict('That question can no longer be skipped.');
    const q = questionAt(play, idx);
    play.answers.push({ id: q.id, cat: q.cat, skipped: true, correct: false, points: 0 });
    play.idx += 1;
    play.openedAt = null;
    recordPlayAnswer(db, play.id, play.idx, play.answers, now);
    if (play.idx >= play.questionIds.length) finish(play);
    return skipped(play, idx);
  }

  function skipped(play, idx) {
    const q = questionAt(play, idx);
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

  return { get: (id) => getPlay(db, id), find: (kind, ref, userId) => findPlay(db, kind, ref, userId), begin, view, previews, peek, open, answer, skip, finish, abandon, pictureFile, endStale };
}
