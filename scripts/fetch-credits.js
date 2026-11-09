// Looks up the author and licence of every Wikimedia picture the questions use and saves
// them to legal/credits.json, which the Photo credits page (/credits) is drawn from.
// Re-run it after adding or changing a picture:
//
//   npm run fetch-credits
//
// Needs internet. Files that aren't freely licensed (such as logos used on Wikipedia under
// "fair use") are listed at the end: those need a decision before the game earns money.

import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { QUESTIONS } from '../shared/questions.js';
import { CATEGORIES } from '../shared/config.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'legal', 'credits.json');
const API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = `SmartsQuiz/1.0 (personal quiz game; photo credits script${process.env.IMAGE_CONTACT ? `; ${process.env.IMAGE_CONTACT}` : ''})`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(params) {
  const url = `${API}?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params })}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT } }).catch(() => null);
    if (res?.ok) return res.json();
    const wait = Number(res?.headers.get('retry-after')) * 1000 || 2000 * attempt;
    process.stdout.write(` (${res ? `HTTP ${res.status}` : 'network error'}, waiting ${Math.round(wait / 1000)}s)`);
    await sleep(wait);
  }
  throw new Error('Wikipedia did not answer after 5 tries');
}

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

/** Follows the API's "normalized" and "redirects" lists from a title as asked to the page's real title. */
function resolver(d) {
  const map = new Map();
  for (const x of [...(d.query?.normalized || []), ...(d.query?.redirects || [])]) map.set(x.from, x.to);
  return (title) => {
    for (let i = 0; i < 5 && map.has(title); i++) title = map.get(title);
    return title;
  };
}

/** Plain text from the HTML Wikimedia puts in its metadata ("<a href=…>Name</a>" → "Name"). */
function plain(html) {
  if (!html) return null;
  const text = String(html)
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 200) : null;
}

// ── Which file each question shows ─────────────────────────────

const topicsOf = new Map(); // "File:…" or article title -> Set of topic ids
const add = (title, cat) => {
  if (!topicsOf.has(title)) topicsOf.set(title, new Set());
  topicsOf.get(title).add(cat);
};
for (const q of QUESTIONS) {
  if (q.visual.type === 'wiki') add(q.visual.title, q.cat);
  if (q.visual.type === 'image' && q.visual.commons) add(`File:${q.visual.commons}`, q.cat);
}

// Articles show their lead image, so first find which file that is.
const articles = [...topicsOf.keys()].filter((t) => !t.startsWith('File:'));
const fileTopics = new Map(); // "File:…" -> Set of topic ids
const missing = [];
const addFile = (file, topics) => {
  if (!fileTopics.has(file)) fileTopics.set(file, new Set());
  for (const t of topics) fileTopics.get(file).add(t);
};
for (const [title, topics] of topicsOf) if (title.startsWith('File:')) addFile(title, topics);

process.stdout.write(`Finding the lead image of ${articles.length} articles`);
for (const batch of chunks(articles, 50)) {
  const d = await query({ prop: 'pageimages', piprop: 'name', redirects: '1', titles: batch.join('|') });
  const real = resolver(d);
  const image = new Map((d.query?.pages || []).map((p) => [p.title, p.pageimage]));
  for (const title of batch) {
    const name = image.get(real(title));
    if (name) addFile(`File:${name.replace(/_/g, ' ')}`, topicsOf.get(title));
    else missing.push(title);
  }
  process.stdout.write('.');
  await sleep(200);
}

// ── Author and licence of each file ────────────────────────────

const files = [...fileTopics.keys()];
process.stdout.write(`\nReading the licence of ${files.length} files`);
const credits = [];
for (const batch of chunks(files, 50)) {
  const d = await query({
    prop: 'imageinfo', iiprop: 'url|extmetadata', iiextmetadatalanguage: 'en',
    iiextmetadatafilter: 'Artist|Credit|LicenseShortName|LicenseUrl|NonFree|UsageTerms',
    titles: batch.join('|'),
  });
  const real = resolver(d);
  const pages = new Map((d.query?.pages || []).map((p) => [p.title, p]));
  for (const file of batch) {
    const info = pages.get(real(file))?.imageinfo?.[0];
    if (!info) {
      missing.push(file);
      continue;
    }
    const m = info.extmetadata || {};
    credits.push({
      file: file.slice('File:'.length),
      page: info.descriptionurl,
      author: plain(m.Artist?.value) || plain(m.Credit?.value),
      license: plain(m.LicenseShortName?.value) || plain(m.UsageTerms?.value),
      licenseUrl: m.LicenseUrl?.value || null,
      nonFree: String(m.NonFree?.value || '').toLowerCase() === 'true',
      topics: [...fileTopics.get(file)],
    });
  }
  process.stdout.write('.');
  await sleep(200);
}

// Topic order as on the home screen, then by file name.
const order = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, i]));
credits.sort((a, b) => order[a.topics[0]] - order[b.topics[0]] || a.file.localeCompare(b.file));
await writeFile(OUT, `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), files: credits }, null, 2)}\n`);

console.log(`\n\nSaved ${credits.length} credits to legal/credits.json.`);
const noLicence = credits.filter((c) => !c.license);
const nonFree = credits.filter((c) => c.nonFree);
if (nonFree.length) {
  console.log(`\n${nonFree.length} files are not freely licensed (Wikipedia uses them under "fair use", which doesn't cover a game that earns money):`);
  for (const c of nonFree) console.log(`  - [${c.topics.join(', ')}] ${c.file}`);
}
if (noLicence.length) {
  console.log(`\n${noLicence.length} files have no licence in their metadata; check their pages by hand:`);
  for (const c of noLicence) console.log(`  - ${c.page}`);
}
if (missing.length) {
  console.log(`\n${missing.length} titles have no picture or file on Wikipedia:`);
  for (const t of missing) console.log(`  - ${t}`);
  process.exitCode = 1;
}
