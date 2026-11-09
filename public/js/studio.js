// The Marketing Studio's videos. A video is a list of scenes on one timeline, and drawFrame() paints
// any moment of it onto a canvas. Everything comes from the game itself (questions, translations,
// avatars, level covers), so all three languages are the same video with the same timing, and the
// editors only have to add sound once.

import EN from '/lang/en.js';
import { ANIMALS, avatarUrl } from '/shared/avatars.js';
import { CATEGORY_BY_ID, LEVEL_TIERS, tierFor } from '/shared/config.js';
import { coverUrl } from './covers.js';

export const LANGS = [
  { id: 'en', name: 'English', dir: 'ltr', ui: '"Schibsted Grotesk"', show: '"Bagel Fat One"' },
  { id: 'he', name: 'Hebrew', dir: 'rtl', ui: '"Rubik"', show: '"Fredoka"' },
  { id: 'ar', name: 'Arabic', dir: 'rtl', ui: '"Cairo"', show: '"Baloo Bhaijaan 2"' },
];
const LANG = Object.fromEntries(LANGS.map((l) => [l.id, l]));

export const FORMATS = {
  story: { w: 1080, h: 1920, name: 'Vertical 9:16', use: 'Reels, TikTok, Stories, Shorts' },
  square: { w: 1080, h: 1080, name: 'Square 1:1', use: 'Instagram and Facebook feed' },
  wide: { w: 1920, h: 1080, name: 'Wide 16:9', use: 'YouTube and the website' },
};

// What the apps' own buttons cover in a vertical video. Shown in the preview, never recorded.
export const SAFE_ZONE = { top: 250, bottom: 420, side: 70 };

const copy = (en, he, ar) => ({ en, he, ar });

export const TEMPLATES = {
  promo: {
    name: 'Main promo',
    about: 'What Smarts is, in about 25 seconds.',
    questions: 2,
    scenes: [
      { id: 'hook', label: 'Hook', kind: 'home', dur: 2600, copy: copy('How much do you really know?', 'כמה אתם באמת יודעים?', 'كم تعرف حقًا؟') },
      { id: 'q1', label: 'Question 1', kind: 'tap', slot: 0, dur: 4800, copy: copy('See a picture. Beat the clock.', 'רואים תמונה. מנצחים את השעון.', 'شاهد الصورة واسبق الوقت.') },
      { id: 'q2', label: 'Question 2', kind: 'tap', slot: 1, dur: 4200, copy: copy('{questions} questions. {topics} topics.', '{questions} שאלות. {topics} נושאים.', '{questions} سؤال و{topics} موضوعًا.') },
      { id: 'level', label: 'Level up', kind: 'levelup', dur: 3200, copy: copy('Level up. Unlock fiercer looks.', 'עולים רמה. פותחים דמויות חדשות.', 'ارفع مستواك وافتح شخصيات جديدة.') },
      { id: 'board', label: 'Daily board', kind: 'board', dur: 3400, copy: copy('One Daily for everyone. Who wins today?', 'אתגר יומי אחד לכולם. מי מנצח היום?', 'تحدٍّ يومي واحد للجميع. من يفوز اليوم؟') },
      { id: 'duel', label: 'Duel', kind: 'duel', dur: 3000, copy: copy('Challenge your friends.', 'אתגרו את החברים.', 'تحدَّ أصدقاءك.') },
      { id: 'cta', label: 'End card', kind: 'cta', dur: 3000, copy: copy('Play free now', 'שחקו עכשיו בחינם', 'العب الآن مجانًا') },
    ],
  },
  challenge: {
    name: 'Can you get all 3?',
    about: 'Viewers try to answer before each reveal. Made to get comments and shares.',
    questions: 3,
    scenes: [
      { id: 'hook', label: 'Hook', kind: 'home', dur: 2200, copy: copy('Can you get all 3?', 'תצליחו לענות על כל השלוש?', 'هل تجيب عن الأسئلة الثلاثة؟') },
      { id: 'q1', label: 'Question 1', kind: 'guess', slot: 0, dur: 5200, copy: copy('Question 1', 'שאלה 1', 'السؤال 1') },
      { id: 'q2', label: 'Question 2', kind: 'guess', slot: 1, dur: 5200, copy: copy('Question 2. Harder.', 'שאלה 2. קשה יותר.', 'السؤال 2. أصعب.') },
      { id: 'q3', label: 'Question 3', kind: 'guess', slot: 2, dur: 5200, copy: copy('Last one.', 'האחרונה.', 'الأخير.') },
      { id: 'cta', label: 'End card', kind: 'cta', dur: 3000, copy: copy('How many did you get? Play free', 'כמה הצלחתם? שחקו בחינם', 'كم إجابة صحيحة؟ العب مجانًا') },
    ],
  },
  looks: {
    name: 'Levels and looks',
    about: 'Shows off the skins, level covers and the level-up moment.',
    questions: 0,
    scenes: [
      { id: 'hook', label: 'Hook', kind: 'home', dur: 2400, copy: copy('Every right answer counts.', 'כל תשובה נכונה נחשבת.', 'كل إجابة صحيحة تُحتسب.') },
      { id: 'skins', label: 'Skins', kind: 'skins', dur: 3800, copy: copy('{skins} skins to collect.', '{skins} דמויות לאסוף.', '{skins} شخصية لتجمعها.') },
      { id: 'level', label: 'Level up', kind: 'levelup', dur: 3200, copy: copy('Level up to unlock them.', 'עולים רמה ופותחים אותן.', 'ارفع مستواك لتفتحها.') },
      { id: 'tiers', label: 'Covers', kind: 'tiers', dur: 3600, copy: copy('From Rookie to Legend.', 'מטירון לאגדה.', 'من مبتدئ إلى أسطورة.') },
      { id: 'cta', label: 'End card', kind: 'cta', dur: 3000, copy: copy('Start your climb. Free.', 'מתחילים לטפס. בחינם.', 'ابدأ الصعود مجانًا.') },
    ],
  },
};

const SAMPLE = {
  en: { me: 'Maya', names: ['Leo', 'Sara', 'Maya', 'Omar', 'Noa', 'Adam'] },
  he: { me: 'מאיה', names: ['יונתן', 'נועה', 'מאיה', 'עומר', 'דנה', 'אדם'] },
  ar: { me: 'ليان', names: ['يوسف', 'سارة', 'ليان', 'عمر', 'نور', 'آدم'] },
};
const ME = 'wolf-angry-crimson-warpaint';
const RIVALS = ['dragon-glow-inferno-flames', 'shark-open-storm-none', ME, 'knight-glow-void-none', 'tiger-open-ember-collar', 'fox-happy-lilac-crown'];
const RIVAL_LEVELS = [50, 31, 13, 24, 18, 9];
const UNLOCKED = 'cobra-slit-toxic-none';
const SKIN_BG = ['sky', 'crimson', 'mint', 'storm', 'lilac', 'ember'];
const TIER_AVATARS = ['cat-open-sky-none', 'fox-angry-crimson-none', 'wolf-open-storm-none', 'tiger-angry-ember-none', 'knight-glow-void-none', 'fiend-open-amethyst-none', 'dragon-glow-inferno-flames'];

const C = {
  cobalt: '#2a3bd1', deep: '#1b2799', ink: '#131c6e', paper: '#fbfbf8', paper2: '#eef0f7', text: '#141833', text2: '#555b7a',
  line: '#dfe2ee', marigold: '#ffc531', marigoldDeep: '#d99a00', mint: '#17b877', mintDeep: '#0d8a57', coral: '#ff5446', white: '#ffffff',
};
const LOGO_FONT = '"Bagel Fat One", system-ui, sans-serif';
const TRANSITION = 320;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = (p) => 1 - (1 - clamp(p)) ** 3;
const pop = (p) => { const x = clamp(p); return 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2; };

// ── Project ────────────────────────────────────────────────────

export const defaultProject = () => ({ template: 'promo', format: 'story', url: '', copy: {}, off: {}, durs: {}, questions: {} });

/** A saved project, with anything missing or no longer valid put back to its default. */
export function normalizeProject(saved) {
  const p = { ...defaultProject(), ...(saved && typeof saved === 'object' ? saved : {}) };
  if (!TEMPLATES[p.template]) p.template = 'promo';
  if (!FORMATS[p.format]) p.format = 'story';
  for (const k of ['copy', 'off', 'durs', 'questions']) if (!p[k] || typeof p[k] !== 'object') p[k] = {};
  return p;
}

/** The scenes that are switched on, with when each one starts. */
export function timeline(project) {
  const id = project.template;
  let at = 0;
  const scenes = [];
  for (const s of TEMPLATES[id].scenes) {
    if (project.off[id]?.[s.id]) continue;
    const dur = project.durs[id]?.[s.id] ?? s.dur;
    scenes.push({ ...s, dur, start: at });
    at += dur;
  }
  return { scenes, total: at };
}

/** A scene's words in one language, with {questions}, {topics} and {skins} filled in. */
export function sceneText(project, kit, scene, lang, { raw = false } = {}) {
  const text = project.copy[project.template]?.[scene.id]?.[lang] ?? scene.copy[lang];
  if (raw) return text;
  const vars = { questions: kit.counts.questions, topics: kit.counts.topics, skins: ANIMALS.length };
  return text.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

/** What a time on the timeline is: "0:04.20". */
export function clock(ms) {
  const cs = Math.round(ms / 10);
  return `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** The moments a sound could go, relative to the start of the video. */
export function soundCues(project) {
  const cues = [];
  for (const s of timeline(project).scenes) {
    const at = (share, what) => cues.push({ ms: Math.round(s.start + s.dur * share), scene: s.label, what });
    at(0, 'Cut to this scene');
    if (s.kind === 'tap') { at(TAP_AT, 'Finger taps the right answer'); at(TAP_AT + 0.02, 'Answer turns green'); at(TAP_AT + 0.14, 'Points appear'); }
    if (s.kind === 'guess') { for (const n of [0, 1, 2]) at((GUESS_REVEAL * n) / 3, `Countdown ${3 - n}`); at(GUESS_REVEAL, 'Answer revealed'); }
    if (s.kind === 'levelup') { at(0.12, 'Sheet slides up'); at(0.34, 'Level number changes'); at(0.56, 'Unlocked item pops in'); }
    if (s.kind === 'board') for (let n = 0; n < 6; n++) at(0.1 + n * 0.08, `Row ${n + 1} appears`);
    if (s.kind === 'duel') { at(0.3, 'Scores count up'); at(0.62, 'Winner revealed'); }
    if (s.kind === 'skins') at(0.08, 'Skins start popping in');
    if (s.kind === 'tiers') LEVEL_TIERS.forEach((tier, n) => at(0.08 + n * 0.09, `${tier.id} cover appears`));
    if (s.kind === 'cta') { at(0.1, 'Logo lands'); at(0.5, 'Button pulses'); }
  }
  return cues;
}

const TAP_AT = 0.5;
const GUESS_REVEAL = 0.74;

// ── What the videos draw on ────────────────────────────────────

const pictureOf = (q, images) => {
  const v = q.visual;
  if (v.type === 'flag') return images.flags.includes(v.code) ? `/img/flags/${v.code}.png` : null;
  if (v.type === 'country') return images.countries.includes(v.iso) ? `/img/countries/${v.iso}.svg` : null;
  if (v.type === 'wiki') return images.photos[q.id]?.src ?? null;
  return null;
};

const FONT_LINKS = [
  'https://fonts.googleapis.com/css2?family=Fredoka:wght@500..700&family=Rubik:wght@400..800&display=swap',
  'https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@500..800&family=Cairo:wght@400..800&display=swap',
];

async function loadFonts() {
  for (const href of FONT_LINKS) {
    if (document.querySelector(`link[href="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    const ready = new Promise((resolve) => { link.onload = resolve; link.onerror = resolve; });
    document.head.append(link);
    await ready;
  }
  const samples = { en: 'Smarts', he: 'שלום', ar: 'مرحبا' };
  await Promise.all(LANGS.flatMap((l) => [400, 600, 700, 800].flatMap((w) => [
    document.fonts.load(`${w} 40px ${l.ui}`, samples[l.id]), document.fonts.load(`${w} 40px ${l.show}`, samples[l.id]),
  ]).concat(document.fonts.load(`400 40px ${LOGO_FONT}`, 'Smarts'))).map((p) => p.catch(() => {})));
}

/** Gathers the questions, translations and fonts. `api` is the app's own request helper. */
export async function loadKit(api) {
  const [data, images, he, ar] = await Promise.all([
    api('/api/marketing/kit'),
    fetch('/img/manifest.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    import('/lang/he/index.js').then((m) => m.default),
    import('/lang/ar/index.js').then((m) => m.default),
    loadFonts(),
  ]);
  const local = { photos: images.photos || {}, flags: images.flags || [], countries: images.countries || [] };
  const packs = { en: { ui: {}, cats: {}, questions: {} }, he, ar };
  const translate = (lang, q, text) => (packs[lang].questions[`${q.cat}|${text}`] ?? packs[lang].questions[text] ?? text);
  const translated = (q) => ['he', 'ar'].every((lang) => [q.prompt, ...q.options].every((s) => !/[a-z]/i.test(s) || translate(lang, q, s) !== s));
  const usable = data.questions
    .map((q) => ({ ...q, picture: pictureOf(q, local), contain: q.visual.type !== 'wiki' || !!q.visual.logo }))
    .filter((q) => q.picture && translated(q));
  return { ...data, packs, translate, usable, byId: new Map(usable.map((q) => [q.id, q])), images: new Map() };
}

const PREFERRED = ['landmarks', 'flags', 'animals', 'food', 'paintings', 'countries'];

/** The questions a video uses: the ones chosen for it, else good defaults from different topics. */
export function videoQuestions(project, kit) {
  const count = TEMPLATES[project.template].questions;
  const chosen = project.questions[project.template] || [];
  const out = [];
  const used = new Set();
  for (let slot = 0; slot < count; slot++) {
    let q = kit.byId.get(chosen[slot]);
    if (!q || used.has(q.id)) {
      const topic = PREFERRED[slot % PREFERRED.length];
      q = kit.usable.find((x) => x.cat === topic && x.difficulty >= 2 && x.difficulty <= 5 && !used.has(x.id) && x.prompt.length < 60) ?? kit.usable.find((x) => !used.has(x.id));
    }
    if (q) { out.push(q); used.add(q.id); }
  }
  return out;
}

function loadImage(kit, url) {
  if (kit.images.has(url)) return kit.images.get(url);
  const ready = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { kit.images.set(url, img); resolve(img); };
    img.onerror = () => { kit.images.delete(url); resolve(null); };
    img.src = url;
  });
  kit.images.set(url, ready);
  return ready;
}

const avatarUrls = new Map();
const urlOfAvatar = (code) => {
  if (!avatarUrls.has(code)) avatarUrls.set(code, avatarUrl(code));
  return avatarUrls.get(code);
};
const skinCode = (animal) => `${animal}-open-${SKIN_BG[ANIMALS.indexOf(animal) % SKIN_BG.length]}-none`;

/** Waits for every picture the current video draws, so no frame shows one missing. */
export async function prepareImages(project, kit) {
  const codes = [ME, UNLOCKED, ...RIVALS, ...TIER_AVATARS, ...ANIMALS.map(skinCode)];
  const urls = [...codes.map(urlOfAvatar), ...LEVEL_TIERS.map((t) => coverUrl(t.id)), ...videoQuestions(project, kit).map((q) => q.picture)];
  await Promise.all(urls.map((u) => loadImage(kit, u)));
}

// ── Drawing helpers ────────────────────────────────────────────

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fillBox(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color;
  rr(ctx, x, y, w, h, r);
  ctx.fill();
}

const fontOf = (L, kind, size, weight) => (kind === 'logo' ? `400 ${size}px ${LOGO_FONT}` : `${weight} ${size}px ${kind === 'show' ? L.show : L.ui}, system-ui, sans-serif`);

/** One line of text. With `maxW` it shrinks to fit. */
function say(g, text, x, y, { size = 16, weight = 700, color = C.text, kind = 'ui', align = 'start', maxW = 0 } = {}) {
  const { ctx, L } = g;
  let s = size;
  ctx.font = fontOf(L, kind, s, weight);
  while (maxW && s > 8 && ctx.measureText(text).width > maxW) {
    s -= 0.5;
    ctx.font = fontOf(L, kind, s, weight);
  }
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function wrap(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function image(ctx, img, x, y, w, h, contain) {
  if (!img?.width) return;
  const ratio = contain ? Math.min(w / img.width, h / img.height) : Math.max(w / img.width, h / img.height);
  const dw = img.width * ratio;
  const dh = img.height * ratio;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** An avatar inside its level's cover, centred on (cx, cy), like coveredAvatar() in the app. */
function covered(g, code, level, cx, cy, size) {
  const { ctx } = g;
  const tier = tierFor(level).id;
  const avatar = g.img(urlOfAvatar(code));
  if (avatar) ctx.drawImage(avatar, cx - size / 2, cy - size / 2, size, size);
  const cover = g.img(coverUrl(tier));
  if (cover) ctx.drawImage(cover, cx - size * 0.75, cy - size * 0.75, size * 1.5, size * 1.5);
  ctx.save();
  ctx.direction = 'ltr';
  ctx.textBaseline = 'middle';
  ctx.font = `400 ${size * 0.3}px ${LOGO_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = ['silver', 'gold', 'platinum', 'diamond'].includes(tier) ? C.text : C.white;
  ctx.fillText(String(level), cx, cy + size * 0.52);
  ctx.restore();
}

function meter(ctx, x, y, w, h, share, rtl, back, front) {
  fillBox(ctx, x, y, w, h, h / 2, back);
  const fw = Math.max(h, w * clamp(share));
  fillBox(ctx, rtl ? x + w - fw : x, y, fw, h, h / 2, front);
}

/** A row of confetti falling from the top, the same on every run. */
function confetti(ctx, p, w, h) {
  const colors = [C.marigold, C.coral, C.mint, '#6fc3ff', C.white];
  for (let i = 0; i < 46; i++) {
    const seed = (i * 7919) % 101 / 101;
    const x = ((i * 53) % 100) / 100 * w + Math.sin(p * 7 + i) * 14;
    const y = -20 + (p * (0.8 + seed) * h * 1.1) - seed * 70;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p * 9 * (seed - 0.5) + i);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(-4, -7, 8, 14);
    ctx.restore();
  }
}

// ── The app's screens, on a 390 × 844 phone ────────────────────

const PHONE_W = 390;
const PHONE_H = 844;

function screenHome(g, p) {
  const { ctx, L, X } = g;
  const rtl = L.dir === 'rtl';
  ctx.fillStyle = C.cobalt;
  ctx.fillRect(0, 0, PHONE_W, PHONE_H);
  ctx.textBaseline = 'alphabetic';
  say(g, 'Smarts', X(20), 62, { size: 28, color: C.white, kind: 'logo' });
  fillBox(ctx, 18, 84, 354, 214, 22, C.ink);
  covered(g, ME, 13, X(76), 138, 76);
  say(g, g.t('home.hi', { name: g.sample.me }), X(138), 136, { size: 28, weight: 800, color: C.white, maxW: 216 });
  say(g, g.tn('home.streak', 12), X(138), 164, { size: 15, weight: 600, color: 'rgba(255,255,255,.75)', maxW: 216 });
  say(g, `${g.t('level.label', { n: 13 })} · ${g.t('level.tier.silver')}`, X(36), 230, { size: 14, weight: 750, color: C.white, maxW: 200 });
  const share = 0.3 + 0.55 * easeOut(p / 0.8);
  meter(ctx, 36, 244, 318, 9, share, rtl, 'rgba(255,255,255,.18)', C.marigold);
  say(g, g.t('level.nextAt', { n: 14 }), X(36), 278, { size: 13, weight: 650, color: 'rgba(255,255,255,.72)', maxW: 318 });
  const press = 1 + Math.sin(p * Math.PI * 4) * 0.012;
  ctx.save();
  ctx.translate(195, 370);
  ctx.scale(press, press);
  fillBox(ctx, -177, -46, 354, 96, 24, C.marigoldDeep);
  fillBox(ctx, -177, -50, 354, 94, 24, C.marigold);
  say(g, g.t('home.quickPlay'), 0, -6, { size: 23, weight: 800, align: 'center', maxW: 320 });
  say(g, g.t('quick.desc', { n: 10 }), 0, 22, { size: 15, weight: 600, color: C.text2, align: 'center', maxW: 320 });
  ctx.restore();
  const row = (y, title, sub) => {
    fillBox(ctx, 18, y, 354, 76, 18, C.paper);
    say(g, title, X(36), y + 32, { size: 18, weight: 750, maxW: 318 });
    say(g, sub, X(36), y + 56, { size: 14, weight: 500, color: C.text2, maxW: 318 });
  };
  row(442, g.t('daily.titlePlain'), g.t('daily.rowDesc'));
  row(530, g.t('duel.cardTitle'), g.t('duel.cardDesc'));
  say(g, g.t('home.topics'), X(20), 650, { size: 19, weight: 750, color: C.white, maxW: 350 });
  ['flags', 'landmarks'].forEach((id, i) => {
    const y = 668 + i * 84;
    fillBox(ctx, 18, y, 354, 74, 18, C.paper);
    say(g, g.cat(id), X(36), y + 44, { size: 18, weight: 750, maxW: 300 });
  });
}

/** A question on screen. `tap` has a finger choose the right answer; otherwise it's revealed after a countdown. */
function screenQuestion(g, p, q, tap) {
  const { ctx, L, X } = g;
  const moment = tap ? TAP_AT : GUESS_REVEAL;
  const done = p >= moment;
  ctx.fillStyle = C.cobalt;
  ctx.fillRect(0, 0, PHONE_W, PHONE_H);
  ctx.textBaseline = 'alphabetic';
  if (!q) return;
  for (let i = 0; i < 10; i++) {
    const x = L.dir === 'rtl' ? 372 - 30 - i * 33 : 18 + i * 33;
    fillBox(ctx, x, 28, 30, 7, 4, i < 2 ? C.mint : i === 2 ? C.white : 'rgba(255,255,255,.3)');
  }
  const secsLeft = clamp(1 - (Math.min(p, moment) / moment) * 0.62);
  meter(ctx, 18, 52, 310, 10, secsLeft, L.dir === 'rtl', 'rgba(255,255,255,.2)', C.marigold);
  ctx.save();
  ctx.direction = 'ltr';
  say(g, String(Math.ceil(15 * secsLeft)), 372, 66, { size: 24, color: C.white, kind: 'logo', align: 'right' });
  ctx.restore();
  fillBox(ctx, 18, 80, 354, 356, 26, C.paper);
  ctx.save();
  rr(ctx, 30, 92, 330, 240, 18);
  ctx.clip();
  ctx.fillStyle = C.paper2;
  ctx.fillRect(30, 92, 330, 240);
  image(ctx, g.img(q.picture), 30, 92, 330, 240, q.contain);
  ctx.restore();
  ctx.font = fontOf(L, 'ui', 21, 750);
  const prompt = wrap(ctx, g.q(q, q.prompt), 318).slice(0, 2);
  prompt.forEach((line, i) => say(g, line, X(36), 368 + i * 28, { size: 21, weight: 750, maxW: 318 }));
  const options = g.order(q);
  options.forEach((option, i) => {
    const y = 448 + i * 76;
    const right = option === q.answer;
    const grow = done && right ? 1 + 0.03 * Math.sin(clamp((p - moment) / 0.18) * Math.PI) : 1;
    ctx.save();
    ctx.translate(195, y + 32);
    ctx.scale(grow, grow);
    ctx.globalAlpha = done && !right ? 0.45 : 1;
    fillBox(ctx, -177, -30, 354, 66, 16, done && right ? C.mintDeep : 'rgba(10,14,60,.45)');
    fillBox(ctx, -177, -32, 354, 64, 16, done && right ? C.mint : C.paper);
    const tx = L.dir === 'rtl' ? 157 : -157;
    say(g, g.q(q, option), tx, 7, { size: 18, weight: 700, color: done && right ? C.white : C.text, maxW: 300 });
    ctx.restore();
  });
  const rightAt = options.indexOf(q.answer);
  const ty = 480 + rightAt * 76;
  if (tap) {
    // A finger comes in from the corner and taps the right answer.
    const inP = clamp((p - (moment - 0.2)) / 0.2);
    const outP = clamp((p - moment - 0.06) / 0.14);
    if (inP > 0 && outP < 1) {
      const tx = 195 + (1 - easeOut(inP)) * 90;
      const y = ty + (1 - easeOut(inP)) * 170;
      ctx.globalAlpha = 1 - outP;
      ctx.fillStyle = 'rgba(255,255,255,.34)';
      ctx.beginPath(); ctx.arc(tx, y, 34 + (done ? 20 * clamp((p - moment) / 0.08) : 0), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.beginPath(); ctx.arc(tx, y, 15, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    const pts = clamp((p - moment - 0.12) / 0.2);
    if (pts > 0) {
      ctx.save();
      ctx.direction = 'ltr';
      ctx.globalAlpha = Math.min(1, pts * 2);
      const s = 44 * pop(pts);
      ctx.font = `400 ${s}px ${LOGO_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 8;
      ctx.strokeStyle = C.ink;
      ctx.strokeText('+3', 300, ty - 50);
      ctx.fillStyle = C.marigold;
      ctx.fillText('+3', 300, ty - 50);
      ctx.restore();
      ctx.textBaseline = 'alphabetic';
    }
  } else if (!done) {
    // The viewer's turn: a big 3, 2, 1 over the picture.
    const beat = Math.min(2, Math.floor(p / (moment / 3)));
    const within = (p - (beat * moment) / 3) / (moment / 3);
    ctx.save();
    ctx.direction = 'ltr';
    ctx.translate(195, 212);
    ctx.scale(pop(within * 2.4), pop(within * 2.4));
    ctx.fillStyle = C.marigold;
    ctx.beginPath(); ctx.arc(0, 0, 62, 0, Math.PI * 2); ctx.fill();
    ctx.font = `400 74px ${LOGO_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.text;
    ctx.fillText(String(3 - beat), 0, 4);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }
}

function screenLevelUp(g, p) {
  const { ctx } = g;
  ctx.fillStyle = C.deep;
  ctx.fillRect(0, 0, PHONE_W, PHONE_H);
  ctx.textBaseline = 'alphabetic';
  const up = easeOut((p - 0.08) / 0.16);
  const top = PHONE_H - up * 660;
  fillBox(ctx, 0, top, PHONE_W, 720, 34, C.paper);
  const level = p >= 0.34 ? 14 : 13;
  const beat = 1 + 0.12 * Math.sin(clamp((p - 0.34) / 0.12) * Math.PI);
  ctx.save();
  ctx.translate(195, top + 150);
  ctx.scale(beat, beat);
  covered(g, ME, level, 0, 0, 132);
  ctx.restore();
  say(g, g.t('level.up'), 195, top + 310, { size: 42, weight: 700, color: C.cobalt, kind: 'show', align: 'center', maxW: 350 });
  say(g, g.t('level.reached', { n: level }), 195, top + 348, { size: 18, weight: 500, color: C.text2, align: 'center', maxW: 340 });
  const item = clamp((p - 0.56) / 0.16);
  if (item > 0) {
    say(g, g.t('level.unlocked'), 195, top + 396, { size: 15, weight: 750, color: C.text2, align: 'center', maxW: 340 });
    const s = 92 * pop(item);
    const img = g.img(urlOfAvatar(UNLOCKED));
    if (img) ctx.drawImage(img, 195 - s / 2, top + 462 - s / 2, s, s);
    say(g, g.t('avatar.animal.cobra'), 195, top + 540, { size: 19, weight: 750, align: 'center', maxW: 340 });
  }
  if (p > 0.34) confetti(ctx, (p - 0.34) / 0.66, PHONE_W, PHONE_H);
}

function screenBoard(g, p) {
  const { ctx, L, X } = g;
  ctx.fillStyle = C.cobalt;
  ctx.fillRect(0, 0, PHONE_W, PHONE_H);
  ctx.textBaseline = 'alphabetic';
  say(g, g.t('daily.titlePlain'), X(20), 62, { size: 15, weight: 750, color: C.marigold, maxW: 350 });
  fillBox(ctx, 18, 80, 354, 744, 26, C.paper);
  fillBox(ctx, 36, 98, 318, 50, 25, C.paper2);
  fillBox(ctx, L.dir === 'rtl' ? 196 : 40, 102, 154, 42, 21, C.paper);
  say(g, g.t('board.today', { n: 128 }), L.dir === 'rtl' ? 273 : 117, 130, { size: 15, weight: 750, align: 'center', maxW: 140 });
  say(g, g.t('board.friends'), L.dir === 'rtl' ? 117 : 273, 130, { size: 15, weight: 750, color: C.text2, align: 'center', maxW: 140 });
  const scores = [30, 28, 27, 25, 24, 21];
  g.sample.names.forEach((name, i) => {
    const q = clamp((p - 0.1 - i * 0.08) / 0.16);
    if (q <= 0) return;
    const y = 166 + i * 108;
    ctx.save();
    ctx.globalAlpha = q;
    ctx.translate((1 - easeOut(q)) * (L.dir === 'rtl' ? -40 : 40), 0);
    if (RIVALS[i] === ME) fillBox(ctx, 28, y, 334, 100, 16, '#fde9b0');
    ctx.save();
    ctx.direction = 'ltr';
    say(g, String(i + 1), X(58), y + 58, { size: 24, weight: 400, color: i === 0 ? C.marigoldDeep : C.text2, kind: 'logo', align: 'center' });
    ctx.restore();
    covered(g, RIVALS[i], RIVAL_LEVELS[i], X(122), y + 44, 58);
    say(g, name, X(176), y + 44, { size: 19, weight: 750, maxW: 110 });
    say(g, g.t('board.right', { c: 10 - Math.floor(i / 2), t: 10 }), X(176), y + 68, { size: 14, weight: 600, color: C.text2, maxW: 110 });
    ctx.save();
    ctx.direction = 'ltr';
    say(g, String(scores[i]), X(330), y + 58, { size: 28, weight: 400, color: C.cobalt, kind: 'logo', align: 'center' });
    ctx.restore();
    ctx.restore();
  });
}

function screenDuel(g, p) {
  const { ctx, X } = g;
  ctx.fillStyle = C.cobalt;
  ctx.fillRect(0, 0, PHONE_W, PHONE_H);
  ctx.textBaseline = 'alphabetic';
  say(g, g.t('duel.title'), X(20), 62, { size: 15, weight: 750, color: C.marigold, maxW: 350 });
  fillBox(ctx, 18, 150, 354, 520, 28, C.paper);
  const won = clamp((p - 0.62) / 0.14);
  if (won > 0) {
    ctx.save();
    ctx.translate(195, 232);
    ctx.scale(pop(won), pop(won));
    say(g, g.t('duel.youWon'), 0, 0, { size: 40, weight: 700, color: C.cobalt, kind: 'show', align: 'center', maxW: 330 });
    ctx.restore();
  }
  const count = clamp((p - 0.3) / 0.3);
  const side = (cx, code, level, name, score) => {
    covered(g, code, level, cx, 348, 112);
    say(g, name, cx, 468, { size: 19, weight: 750, align: 'center', maxW: 140 });
    ctx.save();
    ctx.direction = 'ltr';
    say(g, String(Math.round(score * count)), cx, 544, { size: 54, weight: 400, color: C.cobalt, kind: 'logo', align: 'center' });
    ctx.restore();
  };
  side(X(104), ME, 13, g.t('duel.you'), 26);
  side(X(286), RIVALS[0], 50, g.sample.names[0], 21);
  say(g, g.t('duel.vs'), 195, 356, { size: 16, weight: 800, color: C.text2, align: 'center' });
  fillBox(ctx, 86, 586, 218, 54, 16, C.marigoldDeep);
  fillBox(ctx, 86, 582, 218, 54, 16, C.marigold);
  say(g, g.t('duel.rematch'), 195, 616, { size: 18, weight: 800, align: 'center', maxW: 200 });
}

function screenSkins(g, p) {
  const { ctx, X } = g;
  ctx.fillStyle = C.cobalt;
  ctx.fillRect(0, 0, PHONE_W, PHONE_H);
  ctx.textBaseline = 'alphabetic';
  say(g, g.t('profile.title'), X(20), 62, { size: 24, weight: 800, color: C.white, maxW: 350 });
  fillBox(ctx, 18, 84, 354, 742, 26, C.paper);
  say(g, g.t('profile.animal'), X(36), 124, { size: 19, weight: 800, maxW: 318 });
  const shown = ANIMALS.slice(-20).reverse();
  shown.forEach((animal, i) => {
    const q = clamp((p - 0.08 - i * 0.022) / 0.16);
    if (q <= 0) return;
    const col = i % 4;
    const row = Math.floor(i / 4);
    const size = 76 * pop(q);
    const cx = X(76 + col * 80);
    const cy = 186 + row * 122;
    const img = g.img(urlOfAvatar(skinCode(animal)));
    if (img) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    say(g, g.t(`avatar.animal.${animal}`), cx, cy + 62, { size: 13, weight: 700, align: 'center', maxW: 76 });
  });
}

function screenTiers(g, p) {
  const { ctx, X } = g;
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, PHONE_W, PHONE_H);
  ctx.textBaseline = 'alphabetic';
  const levels = LEVEL_TIERS.map((tier) => tier.from);
  levels.forEach((level, i) => {
    const q = clamp((p - 0.08 - i * 0.09) / 0.14);
    if (q <= 0) return;
    const y = 76 + i * 112;
    ctx.save();
    ctx.globalAlpha = Math.min(1, q * 2);
    ctx.translate(0, (1 - easeOut(q)) * 30);
    covered(g, TIER_AVATARS[i], level, X(92), y, 62);
    say(g, g.t(`level.tier.${LEVEL_TIERS[i].id}`), X(164), y + 2, { size: 25, weight: 800, color: C.white, maxW: 200 });
    say(g, g.t('level.label', { n: level }), X(164), y + 28, { size: 15, weight: 600, color: 'rgba(255,255,255,.7)', maxW: 200 });
    ctx.restore();
  });
}

function drawScreen(g, scene, ms) {
  const p = clamp(ms / scene.dur);
  if (scene.kind === 'home') return screenHome(g, p);
  if (scene.kind === 'tap') return screenQuestion(g, p, g.questions[scene.slot], true);
  if (scene.kind === 'guess') return screenQuestion(g, p, g.questions[scene.slot], false);
  if (scene.kind === 'levelup') return screenLevelUp(g, p);
  if (scene.kind === 'board') return screenBoard(g, p);
  if (scene.kind === 'duel') return screenDuel(g, p);
  if (scene.kind === 'skins') return screenSkins(g, p);
  if (scene.kind === 'tiers') return screenTiers(g, p);
  return undefined;
}

// ── A frame ────────────────────────────────────────────────────

function background(ctx, W, H, ms) {
  ctx.fillStyle = C.cobalt;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.5, H * 0.32, 40, W * 0.5, H * 0.32, Math.max(W, H) * 0.75);
  glow.addColorStop(0, '#3f54ee');
  glow.addColorStop(1, C.deep);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  const unit = Math.min(W, H);
  for (let i = 0; i < 7; i++) {
    const x = (i * 0.17 + 0.08 + Math.sin(ms / 2600 + i) * 0.015) * W;
    const y = ((i * 37) % 100) / 100 * H + Math.cos(ms / 2100 + i * 2) * unit * 0.02;
    ctx.beginPath();
    ctx.arc(x, y, unit * (0.05 + (i % 3) * 0.035), 0, Math.PI * 2);
    ctx.fill();
  }
}

function layoutOf(format, W, H, rtl) {
  if (format === 'wide') {
    const ph = H - 120;
    const pw = (ph * PHONE_W) / PHONE_H;
    return { phone: { x: rtl ? 200 : W - 200 - pw, y: 60, w: pw, h: ph }, head: { x: rtl ? pw + 300 : 120, y: 200, w: W - pw - 420, h: H - 400 }, maxSize: 124, minSize: 60, align: 'start' };
  }
  if (format === 'square') {
    const ph = H - 290;
    return { phone: { x: (W - (ph * PHONE_W) / PHONE_H) / 2, y: 265, w: (ph * PHONE_W) / PHONE_H, h: ph }, head: { x: 70, y: 40, w: W - 140, h: 205 }, maxSize: 86, minSize: 40, align: 'center' };
  }
  const y = 500;
  const ph = H - y - 70;
  const pw = (ph * PHONE_W) / PHONE_H;
  return { phone: { x: (W - pw) / 2, y, w: pw, h: ph }, head: { x: 70, y: 150, w: W - 140, h: 320 }, maxSize: 112, minSize: 52, align: 'center' };
}

/** Fits words in a box: the largest size at which they wrap without breaking out of it. */
function fitHeadline(ctx, L, text, box, maxSize, minSize) {
  for (let size = maxSize; size >= minSize; size -= 4) {
    ctx.font = fontOf(L, 'show', size, 700);
    const lines = wrap(ctx, text, box.w);
    const tall = lines.length * size * 1.16;
    const wide = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (tall <= box.h && wide <= box.w) return { size, lines, fits: true };
  }
  ctx.font = fontOf(L, 'show', minSize, 700);
  return { size: minSize, lines: wrap(ctx, text, box.w), fits: false };
}

function drawHeadline(g, text, layout, p) {
  const { ctx, L } = g;
  const { head, maxSize, minSize, align } = layout;
  const { size, lines } = fitHeadline(ctx, L, text, head, maxSize, minSize);
  const lh = size * 1.16;
  const top = head.y + (head.h - lines.length * lh) / 2;
  const x = align === 'center' ? head.x + head.w / 2 : L.dir === 'rtl' ? head.x + head.w : head.x;
  ctx.save();
  ctx.globalAlpha = clamp(p * 2.4);
  ctx.translate(0, (1 - easeOut(p)) * 34);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align === 'center' ? 'center' : 'start';
  ctx.font = fontOf(L, 'show', size, 700);
  ctx.lineJoin = 'round';
  lines.forEach((line, i) => {
    const y = top + lh * (i + 0.8);
    ctx.lineWidth = size * 0.12;
    ctx.strokeStyle = 'rgba(19,28,110,.55)';
    ctx.strokeText(line, x, y + size * 0.03);
    ctx.fillStyle = C.white;
    ctx.fillText(line, x, y);
  });
  ctx.restore();
}

function drawPhone(g, box, paint) {
  const { ctx } = g;
  const k = box.w / PHONE_W;
  const bezel = 14 * k;
  ctx.save();
  ctx.shadowColor = 'rgba(8,12,60,.5)';
  ctx.shadowBlur = 60 * k;
  ctx.shadowOffsetY = 26 * k;
  fillBox(ctx, box.x - bezel, box.y - bezel, box.w + bezel * 2, box.h + bezel * 2, 56 * k, '#0b0e2a');
  ctx.restore();
  ctx.save();
  rr(ctx, box.x, box.y, box.w, box.h, 44 * k);
  ctx.clip();
  ctx.translate(box.x, box.y);
  ctx.scale(k, k);
  paint();
  ctx.restore();
}

function drawEndCard(g, scene, ms, W, H, format, text) {
  const { ctx, L } = g;
  const p = clamp(ms / scene.dur);
  const unit = Math.min(W, H / (format === 'story' ? 1.3 : 1));
  const cx = W / 2;
  const cy = H * (format === 'story' ? 0.44 : 0.42);
  const logo = pop(clamp((p - 0.04) / 0.2));
  ctx.save();
  ctx.translate(cx, cy - unit * 0.27);
  ctx.scale(logo, logo);
  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `400 ${unit * 0.25}px ${LOGO_FONT}`;
  ctx.fillStyle = C.white;
  ctx.fillText('Smarts', 0, 0);
  ctx.restore();
  ctx.direction = L.dir;
  const box = { x: W * 0.08, y: cy - unit * 0.13, w: W * 0.84, h: unit * 0.3 };
  const { size, lines } = fitHeadline(ctx, L, text, box, format === 'wide' ? 96 : unit * 0.125, 40);
  ctx.save();
  ctx.globalAlpha = clamp((p - 0.16) * 6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = fontOf(L, 'show', size, 700);
  ctx.fillStyle = C.marigold;
  const lh = size * 1.16;
  const top = box.y + (box.h - lines.length * lh) / 2;
  lines.forEach((line, i) => ctx.fillText(line, cx, top + lh * (i + 0.8)));
  ctx.restore();
  const beat = 1 + Math.max(0, Math.sin((p - 0.45) * Math.PI * 5)) * 0.04;
  const bw = Math.min(W * 0.78, unit * 0.86);
  const bh = unit * 0.125;
  const by = cy + unit * 0.22;
  ctx.save();
  ctx.globalAlpha = clamp((p - 0.28) * 6);
  ctx.translate(cx, by + bh / 2);
  ctx.scale(beat, beat);
  fillBox(ctx, -bw / 2, -bh / 2 + 12, bw, bh, bh * 0.32, C.marigoldDeep);
  fillBox(ctx, -bw / 2, -bh / 2, bw, bh, bh * 0.32, C.marigold);
  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let urlSize = bh * 0.44;
  do {
    ctx.font = `800 ${urlSize}px "Schibsted Grotesk", system-ui, sans-serif`;
    urlSize -= 2;
  } while (ctx.measureText(g.url).width > bw * 0.88 && urlSize > 18);
  ctx.fillStyle = C.text;
  ctx.fillText(g.url, 0, 0);
  ctx.restore();
}

/** The address shown on the end card, without "https://". */
export const shownUrl = (project, kit) => (project.url || kit.siteUrl).replace(/^https?:\/\//, '').replace(/\/$/, '');

function painter(ctx, kit, project, lang) {
  const L = LANG[lang];
  const pack = kit.packs[lang];
  const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m) : s);
  const orders = new Map();
  return {
    ctx, L, kit,
    X: (x) => (L.dir === 'rtl' ? PHONE_W - x : x),
    sample: SAMPLE[lang],
    url: shownUrl(project, kit),
    questions: videoQuestions(project, kit),
    t: (key, vars) => fill(pack.ui[key] ?? EN[key] ?? key, vars),
    tn: (key, n) => {
      const form = new Intl.PluralRules(lang).select(n);
      return fill(pack.ui[`${key}_${form}`] ?? pack.ui[`${key}_other`] ?? EN[`${key}_other`] ?? key, { n });
    },
    q: (q, text) => (lang === 'en' ? text : kit.translate(lang, q, text)),
    cat: (id) => pack.cats[id]?.name ?? CATEGORY_BY_ID[id].name,
    img: (url) => { const v = kit.images.get(url); return v instanceof Image ? v : null; },
    // The same order of answers in every language, and in every frame.
    order: (q) => {
      if (!orders.has(q.id)) {
        const score = (s) => [...`${q.id}:${s}`].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
        orders.set(q.id, [...q.options].sort((a, b) => score(a) - score(b)));
      }
      return orders.get(q.id);
    },
  };
}

/** Paints the video at `ms` onto a canvas. `scale` lets the preview draw smaller than the real size. */
export function drawFrame(ctx, project, kit, lang, ms, scale = 1) {
  const { w: W, h: H } = FORMATS[project.format];
  const { scenes, total } = timeline(project);
  const g = painter(ctx, kit, project, lang);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.direction = g.L.dir;
  background(ctx, W, H, ms);
  if (!scenes.length) return;
  const now = clamp(ms, 0, total - 1);
  const index = Math.max(0, scenes.findLastIndex((s) => s.start <= now));
  const scene = scenes[index];
  const previous = scenes[index - 1];
  const local = now - scene.start;
  const blend = previous ? clamp(local / TRANSITION) : 1;
  const layout = layoutOf(project.format, W, H, g.L.dir === 'rtl');
  const words = sceneText(project, kit, scene, lang);

  if (scene.kind === 'cta') {
    if (blend < 1 && previous && previous.kind !== 'cta') {
      ctx.save();
      ctx.globalAlpha = 1 - blend;
      drawPhone(g, layout.phone, () => drawScreen(g, previous, previous.dur));
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = blend;
    drawEndCard(g, scene, local, W, H, project.format, words);
    ctx.restore();
    return;
  }
  drawHeadline(g, words, layout, clamp(local / 520));
  const riseIn = index === 0 ? easeOut(local / 620) : 1;
  const box = { ...layout.phone, y: layout.phone.y + (1 - riseIn) * 160 };
  drawPhone(g, box, () => {
    if (blend < 1 && previous) drawScreen(g, previous, previous.dur);
    ctx.save();
    ctx.globalAlpha = blend;
    ctx.translate((1 - easeOut(blend)) * (g.L.dir === 'rtl' ? -46 : 46), 0);
    drawScreen(g, scene, local);
    ctx.restore();
  });
}

/** Words too long for their space, for the editing panel: [{ scene, lang }]. */
export function fitProblems(ctx, project, kit) {
  const { w: W, h: H } = FORMATS[project.format];
  const problems = [];
  for (const scene of timeline(project).scenes) {
    for (const { id } of LANGS) {
      const L = LANG[id];
      const layout = layoutOf(project.format, W, H, L.dir === 'rtl');
      const text = sceneText(project, kit, scene, id);
      if (!text.trim()) problems.push({ scene: scene.id, lang: id, why: 'empty' });
      else if (scene.kind !== 'cta' && !fitHeadline(ctx, L, text, layout.head, layout.maxSize, layout.minSize).fits) problems.push({ scene: scene.id, lang: id, why: 'long' });
    }
  }
  return problems;
}

// ── For the video editors ──────────────────────────────────────

const csvCell = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** Scene starts, words in each language and places for sound, as a spreadsheet. */
export function editSheetCsv(project, kit) {
  const rows = [['Time', 'Seconds', 'Scene', 'What happens', ...LANGS.map((l) => `${l.name} words`)]];
  const scenes = timeline(project).scenes;
  for (const cue of soundCues(project)) {
    const scene = scenes.find((s) => s.label === cue.scene && cue.what === 'Cut to this scene' && s.start === cue.ms);
    rows.push([clock(cue.ms), (cue.ms / 1000).toFixed(2), cue.scene, cue.what, ...LANGS.map((l) => (scene ? sceneText(project, kit, scene, l.id) : ''))]);
  }
  return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** The headline words as subtitles, for captions or for reading over. */
export function subtitlesSrt(project, kit, lang) {
  const stamp = (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor(ms / 60000) % 60;
    const s = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return timeline(project).scenes
    .map((s, i) => `${i + 1}\r\n${stamp(s.start)} --> ${stamp(s.start + s.dur)}\r\n${sceneText(project, kit, s, lang)}\r\n`)
    .join('\r\n');
}
