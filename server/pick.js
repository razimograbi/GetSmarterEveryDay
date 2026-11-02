// Picks the questions for a Daily Challenge or a duel: a spread from easy to hard, one per
// topic in a mix, never two about the same country, played easiest first.

import { QUESTIONS } from '../shared/questions.js';
import { CATEGORY_BY_ID } from '../shared/config.js';

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
 * topic id. The same `seed` always gives the same questions; `avoid` lists ids to leave out
 * while there are enough others.
 */
export function pickQuestions({ count, category = 'mixed', seed = String(Math.random()), avoid = new Set() }) {
  const random = seeded(seed);
  const inMix = (q) => !CATEGORY_BY_ID[q.cat]?.book && CATEGORY_BY_ID[q.cat]?.quick !== false;
  const all = QUESTIONS.filter(category === 'mixed' ? inMix : (q) => q.cat === category);
  const fresh = all.filter((q) => !avoid.has(q.id));
  const pool = fresh.length >= count * 3 ? fresh : all;

  const picked = [];
  const topics = new Set();
  const about = new Set();
  const ok = (q, { band, oneTopic }) =>
    !picked.includes(q)
    && !(q.about && about.has(q.about.toLowerCase()))
    && (!oneTopic || !topics.has(q.cat))
    && (!band || (q.difficulty >= band[0] && q.difficulty <= band[1]));

  for (let slot = 0; slot < count; slot++) {
    const band = bandFor(slot, count);
    // Loosen the rules only when needed: first the topic limit, then the difficulty band.
    const tries = [{ band, oneTopic: category === 'mixed' }, { band, oneTopic: false }, { band: null, oneTopic: false }];
    for (const rule of tries) {
      const options = pool.filter((q) => ok(q, rule));
      if (!options.length) continue;
      const q = options[Math.floor(random() * options.length)];
      picked.push(q);
      topics.add(q.cat);
      if (q.about) about.add(q.about.toLowerCase());
      break;
    }
  }
  return picked.sort((a, b) => a.difficulty - b.difficulty).map((q) => q.id);
}
