// Languages: English (the default), Hebrew and Arabic.
//
// Interface text comes from public/lang/en.js and, for the other languages, from the
// language pack in public/lang/<id>/ (loaded only when that language is used). Questions
// are stored and graded in English; a pack translates each English string for display,
// with "topic|English" keys for the rare word that needs a different translation in one
// topic. Anything a pack lacks is shown in English.

import EN from '/lang/en.js';

export const LANGUAGES = [
  { id: 'en', name: 'English', dir: 'ltr' },
  { id: 'he', name: 'עברית', dir: 'rtl' },
  { id: 'ar', name: 'العربية', dir: 'rtl' },
];
const BY_ID = Object.fromEntries(LANGUAGES.map((l) => [l.id, l]));
export const isLang = (id) => Object.hasOwn(BY_ID, id);

// Fonts with Hebrew and Arabic letters, loaded only for those languages.
const FONTS = {
  he: 'https://fonts.googleapis.com/css2?family=Fredoka:wght@500..700&family=Rubik:wght@400..800&display=swap',
  ar: 'https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@500..800&family=Cairo:wght@400..800&display=swap',
};

const STORE_KEY = 'smarts:lang';
const EMPTY_PACK = { ui: {}, cats: {}, questions: {} };
const packs = { en: EMPTY_PACK };
let current = 'en';
let pack = EMPTY_PACK;

export const lang = () => current;
export const isRtl = () => BY_ID[current].dir === 'rtl';
/** Locale for dates and numbers. Arabic keeps Western digits, like the rest of the app. */
export const locale = () => (current === 'ar' ? 'ar-u-nu-latn' : current);

/** The language this device chose explicitly before, if any. */
export function savedLang() {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberLang(id) {
  try { localStorage.setItem(STORE_KEY, id); } catch { /* private mode */ }
}

/** The first supported language in the device's preferred languages, or English. */
export function deviceLang() {
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const base = String(tag || '').toLowerCase().split('-')[0];
    if (base === 'iw') return 'he'; // old code for Hebrew, still sent by some Android phones
    if (isLang(base)) return base;
  }
  return 'en';
}

/** Switches the whole app to `id`: loads its pack and fonts, and sets the page language and direction. */
export async function setLang(id) {
  if (!isLang(id)) id = 'en';
  if (!packs[id]) packs[id] = (await import(`/lang/${id}/index.js`)).default;
  current = id;
  pack = packs[id];
  const root = document.documentElement;
  root.lang = id;
  root.dir = BY_ID[id].dir;
  if (FONTS[id] && !document.querySelector(`link[data-font="${id}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONTS[id];
    link.dataset.font = id;
    document.head.append(link);
  }
}

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? vars[k] : m)) : s);

/** Interface text for `key`, with {placeholders} filled from `vars` (inserted as given: escape user text first). */
export function t(key, vars) {
  return fill(pack.ui[key] ?? EN[key] ?? key, vars);
}

/** Plural-aware text: picks key_one, key_two, key_few… by the language's plural rules; {n} is the count. */
export function tn(key, n, vars = {}) {
  const form = new Intl.PluralRules(locale()).select(n);
  const s = pack.ui[`${key}_${form}`] ?? pack.ui[`${key}_other`] ?? EN[`${key}_${n === 1 ? 'one' : 'other'}`] ?? key;
  return fill(s, { ...vars, n });
}

/** A question's prompt, answer or option in the current language. */
export function qt(q, text) {
  if (current === 'en' || text == null || q?.cat === 'stage') return text; // Leveling shows what the admin typed
  const d = pack.questions;
  return d[`${q.cat}|${text}`] ?? d[text] ?? text;
}

export const catName = (c) => pack.cats[c.id]?.name ?? c.name;
export const catBlurb = (c) => pack.cats[c.id]?.blurb ?? c.blurb;
export const reasonLabel = (r) => pack.ui[`reason.${r.id}`] ?? r.label;

export function fmtDate(date, opts) {
  return date.toLocaleDateString(locale(), opts);
}

/** "3 minutes ago", "yesterday"… in the current language. */
export function timeAgo(ts) {
  const intl = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  // Hebrew data writes a single unit as "לפני דקה (1)"; the "(1)" is noise.
  const rtf = { format: (n, unit) => intl.format(n, unit).replace(/\s*\(1\)/, '') };
  const s = Math.round((ts - Date.now()) / 1000);
  if (Math.abs(s) < 60) return rtf.format(0, 'second');
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return rtf.format(m, 'minute');
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return rtf.format(h, 'hour');
  const d = Math.round(h / 24);
  if (Math.abs(d) < 7) return rtf.format(d, 'day');
  return fmtDate(new Date(ts), { day: 'numeric', month: 'short' });
}
