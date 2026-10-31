// Checks the question bank. Run with: npm run validate
//
// Rules:
//  - unique ids, known categories, 5 distinct options (1 answer + 4 wrong)
//  - fairness: if ANY option is longer than 5 words, all five options must be
//    of similar length, so the correct one can't be spotted by its length.
//    "Similar" = every option's character length is within 25% of the longest,
//    and every option's word count is within 4 words of the longest.

import { existsSync } from 'node:fs';
import { QUESTIONS } from '../shared/questions.js';
import { CATEGORIES } from '../shared/config.js';

const PUBLIC = new URL('../public/', import.meta.url);

const MAX_WORDS_BEFORE_RULE = 5;
const MAX_CHAR_SPREAD = 0.25;
const MAX_WORD_SPREAD = 4;

const words = (s) => s.trim().split(/\s+/).length;
const errors = [];
const ids = new Set();
const cats = new Set(CATEGORIES.map((c) => c.id));
const perCat = {};

for (const q of QUESTIONS) {
  const where = q.id;
  if (ids.has(q.id)) errors.push(`${where}: duplicate id`);
  ids.add(q.id);
  if (!cats.has(q.cat)) errors.push(`${where}: unknown category "${q.cat}"`);
  perCat[q.cat] = (perCat[q.cat] || 0) + 1;

  if (!Array.isArray(q.wrong) || q.wrong.length !== 4) errors.push(`${where}: needs exactly 4 wrong options`);
  const options = [q.answer, ...(q.wrong || [])];
  const lower = options.map((o) => o.toLowerCase());
  if (new Set(lower).size !== options.length) errors.push(`${where}: options are not distinct`);

  if (options.some((o) => words(o) > MAX_WORDS_BEFORE_RULE)) {
    const lens = options.map((o) => o.length);
    const ws = options.map(words);
    const longest = Math.max(...lens);
    if (Math.min(...lens) < longest * (1 - MAX_CHAR_SPREAD)) {
      errors.push(`${where}: long options must be similar length (chars ${lens.join('/')})`);
    }
    if (Math.max(...ws) - Math.min(...ws) > MAX_WORD_SPREAD) {
      errors.push(`${where}: long options must have similar word counts (${ws.join('/')})`);
    }
  }

  if (q.visual?.type === 'image' && !existsSync(new URL(q.visual.src.replace(/^\//, ''), PUBLIC))) {
    errors.push(`${where}: image file public${q.visual.src} is missing`);
  }

  if (q.visual?.type === 'country' && !/^\d{3}$/.test(q.visual.iso)) errors.push(`${where}: country iso must be a 3-digit ISO 3166-1 numeric code`);

  if (q.visual?.type === 'code' && /\b(python|javascript|rust|golang|java|kotlin|swift)\b/i.test(q.visual.text)) {
    errors.push(`${where}: code snippet mentions a language name`);
  }
}

// Across a topic, the right answer must not usually be the longest (or shortest) option,
// or players learn to pick by length. Chance is 1 in 5; allow up to 30%.
const MAX_LONGEST_SHARE = 0.3;
const lengthBias = {};
for (const q of QUESTIONS) {
  const opts = [q.answer, ...q.wrong];
  if (!opts.some((o) => words(o) > MAX_WORDS_BEFORE_RULE)) continue;
  const lens = opts.map((o) => o.length);
  const b = (lengthBias[q.cat] ||= { n: 0, longest: [], shortest: [] });
  b.n++;
  const unique = (v) => lens.filter((x) => x === v).length === 1;
  if (q.answer.length === Math.max(...lens) && unique(q.answer.length)) b.longest.push(q.id);
  if (q.answer.length === Math.min(...lens) && unique(q.answer.length)) b.shortest.push(q.id);
}
for (const [cat, b] of Object.entries(lengthBias)) {
  if (b.n < 5) continue;
  for (const kind of ['longest', 'shortest']) {
    if (b[kind].length / b.n > MAX_LONGEST_SHARE) {
      errors.push(`${cat}: the right answer is the ${kind} option in ${b[kind].length} of ${b.n} questions (max ${Math.round(MAX_LONGEST_SHARE * 100)}%): ${b[kind].join(', ')}`);
    }
  }
}

console.log(`Questions: ${QUESTIONS.length}`);
for (const c of CATEGORIES) console.log(`  ${c.name.padEnd(16)} ${perCat[c.id] || 0}`);

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\nAll questions pass.');
