// Renders the picture for each question type.
// render(q) returns { html, ready } — `ready(el)` resolves to true once the picture
// is on screen, or false if it failed, so the timer only starts when it can be seen.

import { signSvg } from './signs.js';
import { esc } from './util.js';
import { t } from './i18n.js';
import { countrySvg, WORLD_ATLAS_URLS } from '/shared/geo.js';

// ── Local copies (made by `npm run fetch-images`) ──────────────

let local = { photos: {}, flags: new Set(), countries: new Set() };

/** Loads public/img/manifest.json if it exists; without it everything is fetched live. */
export async function loadLocalImages() {
  try {
    const res = await fetch('/img/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const m = await res.json();
    local = { photos: m.photos || {}, flags: new Set(m.flags || []), countries: new Set(m.countries || []) };
  } catch { /* no local images: use the live sources */ }
}

const flagSrc = (code) =>
  local.flags.has(code)
    ? { src: `/img/flags/${code}.png`, srcset: '' }
    : { src: `https://flagcdn.com/w640/${code}.png`, srcset: `https://flagcdn.com/w640/${code}.png 1x, https://flagcdn.com/w1280/${code}.png 2x` };

// ── Country outlines (live fallback when they weren't downloaded) ──

let worldAtlas = null;
function loadWorldAtlas() {
  worldAtlas ||= (async () => {
    for (const url of WORLD_ATLAS_URLS) {
      try {
        const res = await fetch(url);
        if (res.ok) return await res.json();
      } catch { /* try the next mirror */ }
    }
    throw new Error('World map data unavailable');
  })().catch((err) => {
    worldAtlas = null; // allow a retry on the next question
    throw err;
  });
  return worldAtlas;
}

// ── Wikipedia lead images ──────────────────────────────────────

const WIKI_CACHE_KEY = 'smarts:wiki:v1';
const wikiCache = (() => {
  try { return JSON.parse(localStorage.getItem(WIKI_CACHE_KEY) || '{}'); } catch { return {}; }
})();
const wikiInflight = new Map();

function saveWikiCache() {
  try { localStorage.setItem(WIKI_CACHE_KEY, JSON.stringify(wikiCache)); } catch { /* storage full or blocked */ }
}

export function forgetWikiImage(title) {
  delete wikiCache[title];
  saveWikiCache();
}

/** A specific image file ("File:Name.jpg", usually on Wikimedia Commons) instead of an article's lead image. */
function wikiFileImage(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url&iiurlwidth=960&titles=${encodeURIComponent(title)}`;
  return fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d) => {
      const info = Object.values(d.query?.pages || {})[0]?.imageinfo?.[0];
      if (!info?.thumburl) throw new Error('No image');
      return { src: info.thumburl, fallback: info.thumburl.replace(/\/\d+px-/, '/500px-') };
    });
}

export function wikiImage(title) {
  if (wikiCache[title]) return Promise.resolve(wikiCache[title]);
  if (wikiInflight.has(title)) return wikiInflight.get(title);
  const remember = (entry) => {
    wikiCache[title] = entry;
    saveWikiCache();
    return entry;
  };
  if (title.startsWith('File:')) {
    const p = wikiFileImage(title).then(remember).finally(() => wikiInflight.delete(title));
    wikiInflight.set(title, p);
    return p;
  }
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const p = fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d) => {
      const thumb = d.thumbnail?.source;
      if (!thumb) throw new Error('No image');
      // Ask for a sharper thumbnail than the default 320px when the original allows it.
      // Wikimedia serves a fixed set of widths, so pick one of those.
      const orig = d.originalimage?.width || 0;
      const want = [960, 500].find((w) => w <= orig && w > (d.thumbnail.width || 0));
      const big = want && /\/\d+px-/.test(thumb) ? thumb.replace(/\/\d+px-/, `/${want}px-`) : thumb;
      return remember({ src: big, fallback: thumb });
    })
    .finally(() => wikiInflight.delete(title));
  wikiInflight.set(title, p);
  return p;
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ── Satellite map ──────────────────────────────────────────────

const TILE = 128; // tiles are fetched one zoom level deeper and shown at half size, for sharp retina maps
const MAX_HALF_W = 240;
const MAX_HALF_H = 220;

function mapTiles({ lat, lon, zoom, ring }) {
  const z = zoom + 1;
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const xf = ((lon + 180) / 360) * n;
  const yf = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const tx = Math.floor(xf);
  const ty = Math.floor(yf);
  // Only the tiles that can be visible in the largest card (about 480×440 px), nearest the
  // marker first, so a slow connection spends its time on what the player actually sees.
  const tiles = [];
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const left = (tx + dx - xf) * TILE;
      const top = (ty + dy - yf) * TILE;
      if (left + TILE < -MAX_HALF_W || left > MAX_HALF_W || top + TILE < -MAX_HALF_H || top > MAX_HALF_H) continue;
      const y = ty + dy;
      if (y < 0 || y >= n) continue;
      const x = (((tx + dx) % n) + n) % n;
      tiles.push({
        src: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
        left,
        top,
        dist: Math.hypot(left + TILE / 2, top + TILE / 2),
      });
    }
  }
  tiles.sort((a, b) => a.dist - b.dist);
  // Pixel width of `ring` degrees of longitude at this zoom (display scale: 256px per tile at `zoom`).
  const ringPx = ring ? Math.max(70, Math.min(230, ring * ((256 * 2 ** zoom) / 360) * 1.3)) : 0;
  return { tiles, ringPx };
}

// ── Public API ─────────────────────────────────────────────────

export function render(q) {
  const v = q.visual;
  switch (v.type) {
    case 'flag': {
      const { src, srcset } = flagSrc(v.code);
      const html = `
        <div class="vis vis-flag">
          <img class="flag-img" alt="${esc(t('vis.flagAlt'))}" src="${best(src)}"${srcset && !workingSrc.has(src) ? ` srcset="${srcset}"` : ''}>
        </div>`;
      return { html, ready: (el) => imgReady(el.querySelector('img')) };
    }

    case 'sign':
      return { html: `<div class="vis vis-sign">${signSvg(v.id)}</div>`, ready: () => Promise.resolve(true) };

    case 'image': {
      const html = `<div class="vis vis-sign"><img class="sign-img" alt="${esc(t('vis.signAlt'))}" src="${best(v.src)}"></div>`;
      return { html, ready: (el) => imgReady(el.querySelector('.sign-img')) };
    }

    case 'country': {
      if (local.countries.has(v.iso)) {
        const html = `<div class="vis vis-country"><img class="country-img" alt="${esc(t('vis.countryAlt'))}" src="${best(`/img/countries/${v.iso}.svg`)}"></div>`;
        return { html, ready: (el) => imgReady(el.querySelector('img')) };
      }
      return {
        html: `<div class="vis vis-country is-loading"><div class="photo-shimmer"></div></div>`,
        ready: async (el) => {
          const box = el.querySelector('.vis-country');
          try {
            const svg = countrySvg(await loadWorldAtlas(), v.iso, { label: "A country's outline" });
            if (!svg) throw new Error('Country not in map data');
            box.innerHTML = svg;
            box.classList.remove('is-loading');
            return true;
          } catch {
            box.innerHTML = missingHtml();
            return false;
          }
        },
      };
    }

    case 'text':
      return { html: '', ready: () => Promise.resolve(true) }; // the question is the whole card

    case 'element':
      return { html: `<div class="vis vis-element">${elementTile(v)}</div>`, ready: () => Promise.resolve(true) };

    case 'code': {
      const cols = Math.max(24, ...v.text.split('\n').map((l) => l.length));
      return { html: `<div class="vis vis-code" style="--cols:${cols}"><pre><code>${esc(v.text)}</code></pre></div>`, ready: () => Promise.resolve(true) };
    }

    case 'map': {
      const { tiles: list, ringPx } = mapTiles(v);
      const tiles = list
        .map((t) => `<img alt="" src="${best(t.src)}" data-left="${t.left.toFixed(1)}" data-top="${t.top.toFixed(1)}" style="left:${t.left.toFixed(1)}px;top:${t.top.toFixed(1)}px">`)
        .join('');
      const html = `
        <div class="vis vis-map" role="img" aria-label="${esc(t('vis.mapAria'))}">
          <div class="map-tiles">${tiles}</div>
          ${ringPx
            ? `<div class="map-ring" aria-hidden="true" style="--ring:${ringPx.toFixed(0)}px"></div>`
            : '<div class="map-marker" aria-hidden="true"><span></span></div>'}
          <small class="map-credit">Imagery © Esri</small>
        </div>`;
      return {
        html,
        // Ready only when every tile that shows inside the card has loaded, so the clock
        // never starts on a half-empty map. A failed tile is retried once.
        ready: async (el) => {
          const box = el.querySelector('.vis-map').getBoundingClientRect();
          const hw = box.width / 2;
          const hh = box.height / 2;
          const visible = [...el.querySelectorAll('.map-tiles img')].filter((img) => {
            const l = Number(img.dataset.left);
            const t = Number(img.dataset.top);
            return l + TILE > -hw && l < hw && t + TILE > -hh && t < hh;
          });
          const results = await Promise.all(
            visible.map(async (img) => {
              if (await imgReady(img)) return true;
              img.src = withRetry(img.src.split('?')[0]);
              return imgReady(img);
            })
          );
          return results.length > 0 && results.every(Boolean);
        },
      };
    }

    case 'wiki': {
      const html = `<div class="vis vis-photo is-loading"><div class="photo-shimmer"></div></div>`;
      return {
        html,
        ready: async (el) => {
          const box = el.querySelector('.vis-photo');
          try {
            let img;
            const saved = local.photos[q.id]?.src;
            if (saved) img = await loadImg(best(saved)).catch(() => null);
            if (!img) {
              const { src, fallback } = await wikiImage(v.title);
              try { img = await loadImg(best(src)); } catch { img = await loadImg(fallback); }
            }
            box.innerHTML = `
              <div class="photo-backdrop" style="background-image:url('${img.src.replace(/'/g, '%27')}')"></div>
              <img class="photo-img" alt="${esc(t('vis.photoAlt'))}" src="${esc(img.src)}">
              <small class="photo-credit">Wikipedia</small>`;
          } catch {
            forgetWikiImage(v.title); // try a fresh lookup next time
            box.innerHTML = missingHtml();
            box.dataset.failed = '1';
          }
          box.classList.remove('is-loading');
          return !box.dataset.failed;
        },
      };
    }
  }
  return { html: '<div class="vis"></div>', ready: () => Promise.resolve(true) };
}

export const missingHtml = () => `<div class="photo-missing"><strong>${esc(t('vis.missingTitle'))}</strong><span>${esc(t('vis.missingText'))}</span></div>`;

// Element families, coloured as on most periodic tables. Colour is a mild hint, never the answer.
const FAMILY = {
  nonmetal: '#2B8A3E',
  noble: '#6741D9',
  alkali: '#E03131',
  alkaline: '#E8590C',
  halogen: '#0C8599',
  metalloid: '#5C940D',
  post: '#495057',
  transition: '#1971C2',
  actinide: '#C2255C',
};

function elementTile({ symbol, number, mass, family }) {
  const fill = FAMILY[family] || '#495057';
  const size = symbol.length > 1 ? 92 : 104;
  return `
    <svg viewBox="0 0 200 200" role="img" aria-label="${esc(t('vis.elementAria', { symbol }))}" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="6" width="188" height="188" rx="18" fill="${fill}"/>
      <rect x="6" y="6" width="188" height="188" rx="18" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="2"/>
      <text x="22" y="46" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="26" fill="#fff">${number}</text>
      <text x="100" y="${symbol.length > 1 ? 136 : 140}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}" fill="#fff" letter-spacing="-2">${esc(symbol)}</text>
      <text x="100" y="178" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="400" font-size="20" fill="rgba(255,255,255,.85)">${esc(mass)}</text>
    </svg>`;
}

const withRetry = (src) => `${src}${src.includes('?') ? '&' : '?'}retry=1`;

// When a download only worked on its retry, remember which address worked so the
// game shows that one (already in the browser cache) instead of fetching it again.
const workingSrc = new Map();
const best = (src) => workingSrc.get(src) || src;

// ── Preloading ─────────────────────────────────────────────────
// Upcoming pictures download fully, one question at a time in order, so on a slow
// connection the next question's picture isn't competing with the one after it.

const preloadQueue = [];
const preloaded = new Map(); // question id -> Promise<boolean>
const preloadedOk = new Set(); // question ids whose picture finished downloading

/** True once a question's picture has been downloaded successfully. */
export const isPreloaded = (q) => preloadedOk.has(q.id);
let preloading = false;

function downloadPicture(q) {
  const v = q.visual;
  // A failed image is tried once more at the same "?retry=1" address the game itself
  // uses when it retries, so a successful second try is already in the browser cache.
  const one = (src) =>
    loadImg(src).then(
      () => true,
      () => loadImg(withRetry(src)).then(() => (workingSrc.set(src, withRetry(src)), true), () => false)
    );
  const all = (srcs) => Promise.all(srcs.map(one)).then((r) => r.every(Boolean));
  switch (v.type) {
    case 'flag':
      return all([flagSrc(v.code).src]);
    case 'country':
      return local.countries.has(v.iso) ? all([`/img/countries/${v.iso}.svg`]) : loadWorldAtlas().then(() => true, () => false);
    case 'wiki': {
      const saved = local.photos[q.id]?.src;
      if (saved) return all([saved]);
      return wikiImage(v.title).then(({ src }) => all([src]), () => false);
    }
    case 'map':
      return all(mapTiles(v).tiles.map((t) => t.src));
    case 'image':
      return all([v.src]);
    default:
      return Promise.resolve(true); // drawn in the page, nothing to download
  }
}

async function pump() {
  if (preloading) return;
  preloading = true;
  while (preloadQueue.length) {
    const { q, resolve } = preloadQueue.shift();
    resolve(await downloadPicture(q).catch(() => false));
  }
  preloading = false;
}

/** Downloads a question's picture right away, skipping the queue. Resolves true if it loaded. */
export function fetchNow(q) {
  if (preloadedOk.has(q.id)) return Promise.resolve(true);
  return downloadPicture(q)
    .catch(() => false)
    .then((ok) => {
      if (ok) preloadedOk.add(q.id);
      return ok;
    });
}

/** Downloads a question's picture ahead of time. Safe to call repeatedly: each picture is fetched once. */
export function preload(q) {
  if (!q?.visual) return Promise.resolve(false);
  if (!preloaded.has(q.id)) {
    preloaded.set(
      q.id,
      new Promise((resolve) => {
        preloadQueue.push({ q, resolve });
        pump();
      }).then((ok) => {
        if (ok) preloadedOk.add(q.id);
        else preloaded.delete(q.id); // allow another try later
        return ok;
      })
    );
  }
  return preloaded.get(q.id);
}

/** Resolves true when the image has loaded, false if it failed. */
function imgReady(img) {
  if (!img) return Promise.resolve(false);
  if (img.complete) return Promise.resolve(img.naturalWidth > 0);
  return new Promise((r) => {
    img.addEventListener('load', () => r(true), { once: true });
    img.addEventListener('error', () => r(false), { once: true });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
