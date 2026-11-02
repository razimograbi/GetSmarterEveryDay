// Checks the question bank. Run with: npm run validate
//
// Rules:
//  - unique ids, known categories, 5 distinct options (1 answer + 4 wrong)
//  - fairness: if ANY option is longer than 5 words, all five options must be
//    of similar length, so the correct one can't be spotted by its length.
//    "Similar" = every option's character length is within 25% of the longest,
//    and every option's word count is within 4 words of the longest.
//  - every question has a difficulty from 0 to 10 (shared/difficulty.js)

import { existsSync } from 'node:fs';
import { QUESTIONS, DIFFICULTY_PROBLEMS } from '../shared/questions.js';
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

errors.push(...DIFFICULTY_PROBLEMS);
for (const q of QUESTIONS) if (q.difficulty === undefined) errors.push(`${q.id}: no difficulty in shared/difficulty.js`);

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

// Translations: every shown string has a Hebrew and Arabic version, and the translated
// options still follow the rules above (distinct, similar length when long, no length bias).
// Car models, code languages and brand names stay in English; strings without letters (years, numbers) need none.
const EN_UI = (await import('../public/lang/en.js')).default;
const LATIN_OPTIONS = new Set(['cars', 'code', 'logos']);
const keepsEnglish = (q, s, option) => (option && LATIN_OPTIONS.has(q.cat)) || !/\p{L}/u.test(s);
const placeholders = (s, skip) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((p) => p !== skip).sort().join(',');
const translationSummary = [];

for (const lang of ['he', 'ar']) {
  const pack = (await import(`../public/lang/${lang}/index.js`)).default;
  const d = pack.questions;
  const used = new Set();
  const missing = new Set();
  const look = (q, s, option = true) => {
    if (keepsEnglish(q, s, option)) return s;
    const key = d[`${q.cat}|${s}`] != null ? `${q.cat}|${s}` : s;
    used.add(key);
    if (!d[key]?.trim()) missing.add(`${q.cat}: ${s}`);
    return d[key] ?? s;
  };
  const bias = {};
  for (const q of QUESTIONS) {
    const where = `${lang} ${q.id}`;
    look(q, q.prompt, false);
    const options = [q.answer, ...q.wrong].map((o) => look(q, o));
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      errors.push(`${where}: translated options are not distinct (${options.join(' | ')})`);
    }
    if (LATIN_OPTIONS.has(q.cat) || !options.some((o) => words(o) > MAX_WORDS_BEFORE_RULE)) continue;
    const lens = options.map((o) => o.length);
    const ws = options.map(words);
    if (Math.min(...lens) < Math.max(...lens) * (1 - MAX_CHAR_SPREAD)) {
      errors.push(`${where}: long options must be similar length (chars ${lens.join('/')})`);
    }
    if (Math.max(...ws) - Math.min(...ws) > MAX_WORD_SPREAD) {
      errors.push(`${where}: long options must have similar word counts (${ws.join('/')})`);
    }
    const b = (bias[q.cat] ||= { n: 0, longest: [], shortest: [] });
    b.n++;
    const unique = (v) => lens.filter((x) => x === v).length === 1;
    if (lens[0] === Math.max(...lens) && unique(lens[0])) b.longest.push(q.id);
    if (lens[0] === Math.min(...lens) && unique(lens[0])) b.shortest.push(q.id);
  }
  for (const [cat, b] of Object.entries(bias)) {
    if (b.n < 5) continue;
    for (const kind of ['longest', 'shortest']) {
      if (b[kind].length / b.n > MAX_LONGEST_SHARE) {
        errors.push(`${lang} ${cat}: the right answer is the ${kind} option in ${b[kind].length} of ${b.n} questions: ${b[kind].join(', ')}`);
      }
    }
  }
  for (const m of missing) errors.push(`${lang}: no translation for "${m}"`);
  const unused = Object.keys(d).filter((k) => !used.has(k));
  if (unused.length) console.warn(`${lang}: ${unused.length} unused question string(s): ${unused.join(' · ')}`);

  // Interface text: every English key with the same {placeholders}, and plurals in this language's forms.
  for (const key of Object.keys(EN_UI)) {
    const plural = key.match(/^(.*)_(one|other)$/);
    if (plural?.[2] === 'one') continue;
    if (plural) {
      const base = plural[1];
      if (pack.ui[`${base}_other`] == null) errors.push(`${lang}: interface text "${base}_other" is missing`);
      for (const f of new Intl.PluralRules(lang).resolvedOptions().pluralCategories) {
        const v = pack.ui[`${base}_${f}`];
        if (v != null && placeholders(v, 'n') !== placeholders(EN_UI[key], 'n')) errors.push(`${lang}: "${base}_${f}" has different {placeholders} than English`);
      }
      continue;
    }
    if (pack.ui[key] == null) errors.push(`${lang}: interface text "${key}" is missing`);
    else if (placeholders(pack.ui[key]) !== placeholders(EN_UI[key])) errors.push(`${lang}: "${key}" has different {placeholders} than English`);
  }
  for (const c of CATEGORIES) if (!pack.cats[c.id]?.name || !pack.cats[c.id]?.blurb) errors.push(`${lang}: topic "${c.id}" has no name or blurb`);
  translationSummary.push(`${lang} ${used.size} strings`);
}

console.log(`Questions: ${QUESTIONS.length}`);
for (const c of CATEGORIES) console.log(`  ${c.name.padEnd(16)} ${perCat[c.id] || 0}`);

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`Translations: ${translationSummary.join(', ')}`);
console.log('\nAll questions pass.');
