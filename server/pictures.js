// The pictures kept on this server (`npm run fetch-images`). Those are served at an address that
// says nothing about them; a picture only available from elsewhere has to keep its real address.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const PUBLIC = join(resolve(import.meta.dirname, '..'), 'public');

let manifest = {};
try { manifest = JSON.parse(readFileSync(join(PUBLIC, 'img', 'manifest.json'), 'utf8')); } catch { /* no local pictures */ }
const localFlags = new Set(manifest.flags || []);
const localCountries = new Set(manifest.countries || []);

export function localPicture(q) {
  const v = q.visual;
  if (v.type === 'wiki') return manifest.photos?.[q.id]?.src ?? null;
  if (v.type === 'flag') return localFlags.has(v.code) ? `/img/flags/${v.code}.png` : null;
  if (v.type === 'country') return localCountries.has(v.iso) ? `/img/countries/${v.iso}.svg` : null;
  return null;
}

// These pictures are named after what they show, so without a copy here the name reaches the
// browser, and it is often the answer.
const NAMED_AFTER_SUBJECT = new Set(['wiki', 'flag', 'country']);

/** Whether a question can be played on the server without its picture giving the answer away. */
export const pictureKeepsSecret = (q) => !NAMED_AFTER_SUBJECT.has(q.visual.type) || !!localPicture(q);
