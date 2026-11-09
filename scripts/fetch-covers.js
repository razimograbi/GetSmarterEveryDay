// Makes the small photo on each topic's card (shared/covers.js) in public/topics/.
//
//   npm i --no-save sharp           needed once: it shrinks the photos; the game itself doesn't use it
//   npm run fetch-covers            make what's missing
//   npm run fetch-covers -- --force make everything again
//
// Needs internet. The files are kept in the repository, so this is only needed after changing one.
// Raise COVERS_VERSION in shared/covers.js too, or phones keep showing the old photo.

import { access, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { COVERS } from '../shared/covers.js';

const PUBLIC = join(resolve(import.meta.dirname, '..'), 'public');
const FORCE = process.argv.includes('--force');
const USER_AGENT = `SmartsQuiz/1.0 (personal quiz game; cover download script${process.env.IMAGE_CONTACT ? `; ${process.env.IMAGE_CONTACT}` : ''})`;
const HEADERS = { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT };
const SOURCE_WIDTH = 500; // what's downloaded, before shrinking
const ON_COLOUR = { trivia: '#9C36B5' }; // a cut-out, shown whole on the topic's colour instead of cropped
const SIZE = 240; // square: a card's photo is 76 CSS pixels wide, on screens up to 3x

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
  const file = join(PUBLIC, 'topics', `${id}.webp`);
  if (!FORCE && (await exists(file))) continue;
  try {
    const params = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url', iiurlwidth: String(SOURCE_WIDTH), titles: title });
    const data = await (await get(`https://en.wikipedia.org/w/api.php?${params}`)).json();
    const info = Object.values(data.query?.pages || {})[0]?.imageinfo?.[0];
    if (!info) throw new Error('file not found');
    const bytes = Buffer.from(await (await get(info.thumburl || info.url)).arrayBuffer());
    const image = ON_COLOUR[id]
      ? sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: ON_COLOUR[id] } })
        .composite([{ input: await sharp(bytes).resize(Math.round(SIZE * 0.8), Math.round(SIZE * 0.8), { fit: 'inside' }).toBuffer() }])
      : sharp(bytes).flatten({ background: '#ffffff' }).resize(SIZE, SIZE, { fit: 'cover', position: sharp.strategy.attention });
    const small = await image.webp({ quality: 60, effort: 6 }).toBuffer();
    await writeFile(file, small);
    console.log(`${id}: ${Math.round(small.length / 1024)} KB`);
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
