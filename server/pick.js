// Picks the questions for a Daily Challenge or a duel: a spread from easy to hard, one per
// topic in a mix, never two about the same country, played easiest first.

import { QUESTIONS, QUESTION_BY_ID } from '../shared/questions.js';
import { inQuickRounds } from '../shared/config.js';
import { pictureKeepsSecret } from './pictures.js';

const inPool = (category) => (q) => pictureKeepsSecret(q) && (category === 'mixed' ? inQuickRounds(q) : q.cat === category);

/** Whether a topic has enough questions that can be played without giving their answers away. */
export const hasEnoughQuestions = (category, count) => QUESTIONS.filter(inPool(category)).length >= count;

// For a round of 10: 3 easy (0–3), 4 medium (4–6) and 3 hard (7–10). Longer rounds stretch it.
const BANDS = [[0, 3], [4, 6], [7, 10]];
const bandFor = (slot, count) => BANDS[Math.min(2, Math.floor(((slot + 0.5) / count) * 3))];

/** A repeatable random number generator from a seed string (mulberry32). */
function seeded(seed) {
  let h = 1779033703 ^ seed.length;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 3432918353), (h = (h << 13) | (h >>> 19));
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Question ids for a round. `category` is 'mixed' (every topic that plays in Quick rounds) or a
 * topic id. The same `seed` and sets always give the same questions.
 *
 * Each slot takes the lowest-cost questions, so the rules give way only when they must:
 * `avoid` (ids that shouldn't come back, like the duel a rematch follows) matters most, then the
 * slot's difficulty, then `seenRecently` (ids the players met lately), then one question per topic.
 */
export function pickQuestions({ count, category = 'mixed', seed = String(Math.random()), avoid = new Set(), seenRecently = new Set() }) {
  const random = seeded(seed);
  const mixed = category === 'mixed';
  const pool = QUESTIONS.filter(inPool(category));

  const picked = [];
  const topics = new Set();
  const about = new Set();
  const cost = (q, band) =>
    (avoid.has(q.id) ? 100 : 0)
    + (q.difficulty < band[0] || q.difficulty > band[1] ? 10 : 0)
    + (seenRecently.has(q.id) ? 2 : 0)
    + (mixed && topics.has(q.cat) ? 1 : 0);

  for (let slot = 0; slot < count; slot++) {
    const band = bandFor(slot, count);
    const options = pool.filter((q) => !picked.includes(q) && !(q.about && about.has(q.about.toLowerCase())));
    if (!options.length) break;
    const lowest = Math.min(...options.map((q) => cost(q, band)));
    const best = options.filter((q) => cost(q, band) === lowest);
    const q = best[Math.floor(random() * best.length)];
    picked.push(q);
    topics.add(q.cat);
    if (q.about) about.add(q.about.toLowerCase());
  }
  return picked.sort((a, b) => a.difficulty - b.difficulty).map((q) => q.id);
}

/**
 * A question to take the place of one that was taken out of the bank after a round was picked:
 * `ids` is the round as it stands and `slot` the place to fill. It's of the slot's difficulty and
 * not about anything the round already asks about. The same arguments always give the same id.
 * Falls back to a mixed question if the topic has none left, and returns null if nothing fits.
 */
export function pickReplacement({ ids, slot, category = 'mixed', seed, avoid = new Set() }) {
  const random = seeded(seed);
  const band = bandFor(slot, ids.length);
  const taken = new Set(ids);
  const about = new Set(ids.map((id) => QUESTION_BY_ID.get(id)?.about?.toLowerCase()).filter(Boolean));
  const fits = (q) => !taken.has(q.id) && !(q.about && about.has(q.about.toLowerCase()));
  let pool = QUESTIONS.filter((q) => inPool(category)(q) && fits(q));
  if (!pool.length && category !== 'mixed') pool = QUESTIONS.filter((q) => inPool('mixed')(q) && fits(q));
  if (!pool.length) return null;
  const cost = (q) => (avoid.has(q.id) ? 100 : 0) + (q.difficulty < band[0] || q.difficulty > band[1] ? 10 : 0);
  const lowest = Math.min(...pool.map(cost));
  const best = pool.filter((q) => cost(q) === lowest);
  return best[Math.floor(random() * best.length)].id;
}
