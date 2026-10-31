// Confirms every Wikipedia-backed question resolves to an image: an article's lead image,
// or a specific "File:…" image. Run on your own machine (needs internet): npm run check-images

import { QUESTIONS } from '../shared/questions.js';

const wiki = QUESTIONS.filter((q) => q.visual.type === 'wiki');
const HEADERS = { 'User-Agent': 'smarts-quiz/0.1 (image check)' };
let missing = 0;

async function imageFor(title) {
  if (title.startsWith('File:')) {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url&iiurlwidth=500&titles=${encodeURIComponent(title)}`, { headers: HEADERS });
    const info = res.ok ? Object.values((await res.json()).query?.pages || {})[0]?.imageinfo?.[0] : null;
    return { src: info?.thumburl, why: res.ok ? 'file not found' : `HTTP ${res.status}` };
  }
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { headers: HEADERS });
  const data = res.ok ? await res.json() : null;
  return { src: data?.thumbnail?.source, why: res.ok ? 'no lead image' : `HTTP ${res.status}` };
}

for (const q of wiki) {
  try {
    const { src, why } = await imageFor(q.visual.title);
    if (!src) {
      missing++;
      console.log(`✗ ${q.id.padEnd(28)} "${q.visual.title}" — ${why}`);
    } else {
      console.log(`✓ ${q.id.padEnd(28)} ${src}`);
    }
  } catch (err) {
    missing++;
    console.log(`✗ ${q.id.padEnd(28)} ${err.message}`);
  }
}

console.log(`\n${wiki.length - missing}/${wiki.length} Wikipedia images found.`);
process.exit(missing ? 1 : 0);
