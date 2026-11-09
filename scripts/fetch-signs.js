// Downloads the sign drawings that image questions need (the Israeli road signs) from
// Wikimedia Commons into public/signs/. The files are kept in the repository, so this is
// only needed when you add signs or a file goes missing.
//
//   npm run fetch-signs            download what's missing
//   npm run fetch-signs -- --force re-download everything
//
// Needs internet. Wikimedia limits how fast files can be downloaded, so this goes slowly
// on purpose and waits when asked to. Safe to stop and re-run: finished files are skipped.

import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { QUESTIONS } from '../shared/questions.js';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const FORCE = process.argv.includes('--force');
const GAP_MS = 1500; // pause between downloads, to stay under Wikimedia's rate limit

// Wikimedia asks automated clients to identify themselves; anonymous requests get throttled sooner.
const USER_AGENT = `SmartsQuiz/1.0 (personal quiz game; sign download script${process.env.IMAGE_CONTACT ? `; ${process.env.IMAGE_CONTACT}` : ''})`;
const HEADERS = { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

async function download(url) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    } catch (err) {
      if (attempt === 6) throw new Error(`network error: ${err.message}`);
      await sleep(2000 * attempt);
      continue;
    }
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 429 || res.status >= 500) {
      // Rate limited or server hiccup: wait as long as the server asks, or longer each time.
      const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * 2 ** (attempt - 1);
      process.stdout.write(` (HTTP ${res.status}, waiting ${Math.round(wait / 1000)}s)`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error('gave up after 6 tries');
}

const wanted = QUESTIONS.filter((q) => q.visual.type === 'image' && q.visual.commons);
const failures = [];
let fetched = 0;

console.log(`${wanted.length} sign drawings in the question bank.`);
for (const [i, q] of wanted.entries()) {
  const file = join(PUBLIC, q.visual.src.replace(/^\//, ''));
  if (!FORCE && (await exists(file))) continue;
  process.stdout.write(`  [${i + 1}/${wanted.length}] ${q.visual.commons} …`);
  try {
    const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(q.visual.commons.replace(/ /g, '_'))}`;
    const data = await download(url);
    if (!/<svg[\s>]/.test(data.toString('utf8', 0, 4000))) throw new Error('not an SVG file');
    if (/<script|\son\w+=|javascript:/i.test(data.toString('utf8'))) throw new Error('file contains script, skipped');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
    fetched++;
    console.log(` ok (${Math.round(data.length / 1024)} KB)`);
  } catch (err) {
    failures.push(`${q.id}: ${err.message}`);
    console.log(` FAILED: ${err.message}`);
  }
  await sleep(GAP_MS);
}

const have = (await Promise.all(wanted.map((q) => exists(join(PUBLIC, q.visual.src.replace(/^\//, '')))))).filter(Boolean).length;
console.log(`\nDone: downloaded ${fetched}, ${have}/${wanted.length} sign drawings in place.`);
if (failures.length) {
  console.log(`${failures.length} failed:\n  ${failures.join('\n  ')}\nRe-run to retry (Wikimedia may need a few minutes to stop rate limiting).`);
  process.exit(1);
}
