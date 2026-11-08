// Picks the questions for a Daily Challenge or a duel: a spread from easy to hard, one per
// topic in a mix, never two about the same country, played easiest first.

import { QUESTIONS } from '../shared/questions.js';
import { inQuickRounds } from '../shared/config.js';

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
  const pool = QUESTIONS.filter(mixed ? inQuickRounds : (q) => q.cat === category);

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
