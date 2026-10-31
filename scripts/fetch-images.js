// Downloads every question picture into public/img so the game loads them from your
// own server instead of hotlinking Wikipedia and flagcdn on every play.
//
//   npm run fetch-images            download what's missing
//   npm run fetch-images -- --force re-download everything
//
// Needs internet. Safe to stop and re-run: finished files are skipped.

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUESTIONS } from '../shared/questions.js';
import { countrySvg, WORLD_ATLAS_URLS } from '../shared/geo.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMG = join(ROOT, 'public', 'img');
const FORCE = process.argv.includes('--force');

// Wikimedia asks automated clients to identify themselves; anonymous "node" requests get throttled or refused.
const USER_AGENT = `SmartsQuiz/1.0 (personal quiz game; image download script${process.env.IMAGE_CONTACT ? `; ${process.env.IMAGE_CONTACT}` : ''})`;
const HEADERS = { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

async function get(url, { json = false } = {}) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    } catch (err) {
      if (attempt === 5) throw new Error(`network error: ${err.message}`);
      await sleep(1000 * attempt);
      continue;
    }
    if (res.ok) return json ? res.json() : Buffer.from(await res.arrayBuffer());
    if (res.status === 429 || res.status >= 500) {
      // Rate limited or server hiccup: wait (as long as the server asks) and try again.
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** (attempt - 1);
      process.stdout.write(` (HTTP ${res.status}, waiting ${Math.round(wait / 1000)}s)`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error('gave up after 5 tries');
}

// Wikimedia only serves a fixed set of thumbnail widths.
function pickThumb(summary) {
  const thumb = summary.thumbnail?.source;
  if (!thumb) return null;
  const orig = summary.originalimage?.width || 0;
  const want = [960, 500].find((w) => w <= orig && w > (summary.thumbnail.width || 0));
  return want && /\/\d+px-/.test(thumb) ? thumb.replace(/\/\d+px-/, `/${want}px-`) : thumb;
}

/** Image URLs to try for a question: an article's lead image, or a specific "File:…" image. */
async function imageCandidates(title) {
  if (title.startsWith('File:')) {
    const d = await get(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url&iiurlwidth=960&titles=${encodeURIComponent(title)}`, { json: true });
    const info = Object.values(d.query?.pages || {})[0]?.imageinfo?.[0];
    if (!info?.thumburl) throw new Error(`"${title}" was not found`);
    return { candidates: [info.thumburl], page: info.descriptionurl || null };
  }
  const summary = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { json: true });
  if (summary.type === 'disambiguation') throw new Error(`"${title}" is a disambiguation page`);
  const candidates = [pickThumb(summary), summary.thumbnail?.source].filter(Boolean);
  if (!candidates.length) throw new Error(`"${title}" has no lead image`);
  return { candidates, page: summary.content_urls?.desktop?.page || null };
}

const extOf = (url) => (/\.(jpe?g|png|gif|webp)(?:$|\?)/i.exec(url)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');

async function loadManifest() {
  try {
    return JSON.parse(await readFile(join(IMG, 'manifest.json'), 'utf8'));
  } catch {
    return { photos: {}, flags: [] };
  }
}

const manifest = await loadManifest();
manifest.photos ||= {};
manifest.flags ||= [];
manifest.countries ||= [];
const failures = [];

// ── Photos (Wikipedia lead images) ─────────────────────────────

const photoQs = QUESTIONS.filter((q) => q.visual.type === 'wiki');
await mkdir(join(IMG, 'q'), { recursive: true });
console.log(`Photos: ${photoQs.length}`);

for (const [i, q] of photoQs.entries()) {
  const have = manifest.photos[q.id];
  if (!FORCE && have && (await exists(join(ROOT, 'public', have.src)))) continue;
  process.stdout.write(`  [${i + 1}/${photoQs.length}] ${q.id} … `);
  try {
    const { candidates, page } = await imageCandidates(q.visual.title);
    let data, url;
    for (url of new Set(candidates)) {
      try { data = await get(url); break; } catch (err) { if (url === candidates.at(-1)) throw err; }
    }
    const src = `/img/q/${q.id}.${extOf(url)}`;
    await writeFile(join(ROOT, 'public', src), data);
    manifest.photos[q.id] = { src, page };
    console.log(`ok (${Math.round(data.length / 1024)} KB)`);
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    failures.push(`${q.id}: ${err.message}`);
  }
  await sleep(process.env.FETCH_DELAY_MS ? Number(process.env.FETCH_DELAY_MS) : 250); // be polite to Wikimedia
}

// ── Flags (flagcdn.com) ───────────────────────────────────────

const codes = [...new Set(QUESTIONS.filter((q) => q.visual.type === 'flag').map((q) => q.visual.code))];
await mkdir(join(IMG, 'flags'), { recursive: true });
console.log(`\nFlags: ${codes.length}`);
const flagSet = new Set(manifest.flags);
for (const code of codes) {
  const file = join(IMG, 'flags', `${code}.png`);
  if (!FORCE && flagSet.has(code) && (await exists(file))) continue;
  try {
    await writeFile(file, await get(`https://flagcdn.com/w1280/${code}.png`));
    flagSet.add(code);
    process.stdout.write(`${code} `);
  } catch (err) {
    failures.push(`flag ${code}: ${err.message}`);
  }
}
manifest.flags = [...flagSet].sort();

// ── Country outlines (world-atlas) ────────────────────────────

const countryQs = QUESTIONS.filter((q) => q.visual.type === 'country');
await mkdir(join(IMG, 'countries'), { recursive: true });
console.log(`\n\nCountry outlines: ${countryQs.length}`);
const countrySet = new Set(manifest.countries);
const missingShapes = [];
for (const q of countryQs) if (FORCE || !countrySet.has(q.visual.iso) || !(await exists(join(IMG, 'countries', `${q.visual.iso}.svg`)))) missingShapes.push(q);
if (missingShapes.length) {
  let topo = null;
  for (const url of WORLD_ATLAS_URLS) {
    try { topo = JSON.parse((await get(url)).toString('utf8')); break; } catch (err) { console.log(`  ${url}: ${err.message}`); }
  }
  if (!topo) {
    failures.push('country outlines: could not download world-atlas map data');
  } else {
    for (const q of missingShapes) {
      const svg = countrySvg(topo, q.visual.iso, { label: "A country's outline" });
      if (!svg) { failures.push(`${q.id}: country ${q.visual.iso} not found in map data`); continue; }
      await writeFile(join(IMG, 'countries', `${q.visual.iso}.svg`), svg);
      countrySet.add(q.visual.iso);
      process.stdout.write(`${q.answer} (${Math.round(svg.length / 1024)} KB)  `);
    }
  }
}
manifest.countries = [...countrySet].sort();
manifest.generated = new Date().toISOString();
await writeFile(join(IMG, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\n\nDone: ${Object.keys(manifest.photos).length}/${photoQs.length} photos, ${manifest.flags.length}/${codes.length} flags, ${manifest.countries.length}/${countryQs.length} country outlines saved in public/img.`);
if (failures.length) {
  console.log(`\n${failures.length} failed:`);
  for (const f of failures) console.log('  - ' + f);
  console.log('\nRe-run to retry. If a title keeps failing, its Wikipedia title in shared/questions.js needs changing.');
  process.exitCode = 1;
}
