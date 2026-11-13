// Grades the Quick and topic rounds the browser sends, against shared/questions.js.

import { QUESTION_BY_ID } from '../shared/questions.js';
import { MODES, DEFAULT_MODE, pointsFor, secondsFor } from '../shared/config.js';

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

/**
 * Grades a Quick or topic round, from shared/questions.js. These only count towards the player's
 * own progress; Daily and duel answers are graded one at a time in server/play.js.
 */
export function grade(answers, { modeCfg = MODES[DEFAULT_MODE] } = {}) {
  if (!Array.isArray(answers) || answers.length > 50 || !answers.length) throw badRequest('A round needs between 1 and 50 answers.');
  const graded = [];
  const seen = new Set();
  for (const a of answers) {
    if (typeof a?.id !== 'string') throw badRequest('Each answer needs a question id.');
    const q = QUESTION_BY_ID.get(a.id);
    // Taken out of the bank since the round was played (a round saved on the phone and sent
    // later): the rest of the round still counts.
    if (!q) continue;
    if (seen.has(q.id)) throw badRequest(`Question "${q.id}" appears twice in one round.`);
    seen.add(q.id);
    const seconds = secondsFor(q, modeCfg); // some topics (the books) allow more time
    const limitMs = seconds * 1000;
    const rawMs = Number(a.ms);
    const validMs = Number.isFinite(rawMs) && rawMs >= 0;
    const ms = validMs ? Math.min(limitMs, Math.round(rawMs)) : limitMs;
    const choice = typeof a.choice === 'string' ? a.choice.slice(0, 200) : null;
    const inTime = validMs && rawMs <= limitMs + 1000; // small allowance for render jitter
    const correct = inTime && choice === q.answer;
    graded.push({ id: q.id, cat: q.cat, choice, correct, ms, points: pointsFor(correct, ms, seconds) });
  }
  return graded;
}
