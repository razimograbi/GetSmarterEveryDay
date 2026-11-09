// Downloads the photo on each topic's card (shared/covers.js) into public/topics/.
//
//   npm run fetch-covers            download what's missing
//   npm run fetch-covers -- --force download everything again
//
// Needs internet. The files are kept in the repository, so this is only needed after changing one.

import { access, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { COVERS, coverSrc } from '../shared/covers.js';

const PUBLIC = join(resolve(import.meta.dirname, '..'), 'public');
const FORCE = process.argv.includes('--force');
const USER_AGENT = `SmartsQuiz/1.0 (personal quiz game; cover download script${process.env.IMAGE_CONTACT ? `; ${process.env.IMAGE_CONTACT}` : ''})`;
const HEADERS = { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT };
const WIDTH = 500; // a card's photo is about 130 CSS pixels wide, on screens up to 3x

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

async function get(url) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { headers: HEADERS }).catch(() => null);
    if (res?.ok) return res;
    if (res && res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status}`);
    await sleep(Number(res?.headers.get('retry-after')) * 1000 || 2000 * attempt);
  }
  throw new Error('gave up after 5 tries');
}

await mkdir(join(PUBLIC, 'topics'), { recursive: true });
const failures = [];
for (const [id, title] of Object.entries(COVERS)) {
  const file = join(PUBLIC, coverSrc(id));
  if (!FORCE && (await exists(file))) continue;
  try {
    const params = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url', iiurlwidth: String(WIDTH), titles: title });
    const data = await (await get(`https://en.wikipedia.org/w/api.php?${params}`)).json();
    const info = Object.values(data.query?.pages || {})[0]?.imageinfo?.[0];
    if (!info) throw new Error('file not found');
    const bytes = Buffer.from(await (await get(info.thumburl || info.url)).arrayBuffer());
    await writeFile(file, bytes);
    console.log(`${id}: ${Math.round(bytes.length / 1024)} KB`);
  } catch (err) {
    failures.push(`${id} (${title}): ${err.message}`);
  }
  await sleep(1000); // stays under Wikimedia's rate limit
}

if (failures.length) {
  console.log(`\n${failures.length} failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
