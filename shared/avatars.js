// Player avatars: an illustrated animal with a face, a background colour and an accessory,
// drawn as SVG. Shared by the browser (to draw them) and the server (to check a chosen avatar).
//
// An avatar is stored as a code: "animal-eyes-background-extra", for example
// "fox-happy-marigold-crown". avatarSvg(code) draws it; avatarUrl(code) gives an image address.

//
// The first parts of each list are open to everyone. The rest unlock with the player's level and
// are listed in the order they unlock (see UNLOCKS). Add-ons work on every skin.

import { COINS } from './config.js';

export const ANIMALS = [
  'cat', 'fox', 'bear', 'panda', 'koala', 'rabbit', 'owl', 'penguin', 'frog', 'lion', 'dog', 'monkey',
  'wolf', 'ninja', 'shark', 'cobra', 'robot', 'tiger', 'bull', 'alien', 'knight', 'panther', 'fiend', 'skull', 'phoenix', 'dragon',
];
export const EYES = ['open', 'happy', 'wink', 'angry', 'glow', 'hollow', 'slit', 'fire', 'laser'];
// One colour, or two for a glow from the first in the middle to the second at the edge.
export const BACKGROUNDS = {
  marigold: '#FFC531',
  mint: '#3CCB8F',
  coral: '#FF7A6B',
  sky: '#6CC4F0',
  lilac: '#B79CFF',
  pink: '#FF9EC4',
  teal: '#2BB3A6',
  peach: '#FFB37A',
  cloud: '#E9ECF7',
  cobalt: '#4A5BF0',
  night: '#2B3170',
  crimson: ['#F0314A', '#4C0615'],
  glacier: ['#BFEFFF', '#1C5C9E'],
  ember: ['#FF9A3D', '#5A1505'],
  toxic: ['#9BFF3C', '#0D3B1C'],
  storm: ['#57C7FF', '#101E5C'],
  amethyst: ['#C77DFF', '#2E0B5E'],
  aurora: ['#39FFC2', '#0B1446'],
  void: ['#3A2A6B', '#07070F'],
  inferno: ['#FF5A1F', '#2A0508'],
  gold: ['#FFE588', '#A86A00'],
};
export const EXTRAS = [
  'none', 'glasses', 'sunglasses', 'crown', 'party', 'headphones', 'bow', 'beanie', 'gradcap',
  'tribal', 'warpaint', 'bandana', 'goggles', 'scar', 'eyepatch', 'hood', 'mohawk', 'katana', 'collar', 'wings', 'horns', 'halo', 'visor', 'chain', 'flames', 'aura', 'ascended',
];

// The level that unlocks each creature skin.
const SKIN_LEVELS = {
  wolf: 3, ninja: 6, shark: 10, cobra: 13, robot: 16, tiger: 20, bull: 24, alien: 28, knight: 30, panther: 36, fiend: 40, skull: 44, phoenix: 48, dragon: 50,
};

// The add-on each level unlocks. Levels skipped here unlock none; anything not listed is free.
const LADDER = {
  2: 'eyes:angry', 3: 'extra:tribal', 4: 'bg:crimson', 5: 'extra:warpaint', 6: 'bg:glacier', 7: 'bg:ember', 8: 'extra:bandana', 9: 'eyes:glow',
  10: 'extra:goggles', 11: 'bg:toxic', 12: 'extra:scar', 13: 'eyes:hollow', 14: 'bg:storm', 15: 'extra:eyepatch', 16: 'extra:hood', 17: 'extra:mohawk', 18: 'bg:amethyst', 19: 'eyes:slit',
  20: 'extra:katana', 22: 'extra:collar', 24: 'bg:aurora', 26: 'bg:void', 28: 'eyes:fire',
  30: 'extra:wings', 32: 'extra:horns', 34: 'bg:inferno', 36: 'extra:halo', 38: 'extra:visor',
  40: 'eyes:laser', 42: 'extra:chain', 44: 'bg:gold', 46: 'extra:flames', 48: 'extra:aura',
  50: 'extra:ascended',
};

export const UNLOCKS = [
  ...Object.entries(SKIN_LEVELS).map(([value, level]) => ({ level, part: 'animal', value })),
  ...Object.entries(LADDER).map(([level, what]) => {
    const [part, value] = what.split(':');
    return { level: Number(level), part, value };
  }),
].sort((a, b) => a.level - b.level);
const LEVEL_OF = new Map(UNLOCKS.map((u) => [`${u.part}:${u.value}`, u.level]));

/** The level that unlocks one part of an avatar, such as ('animal', 'wolf'). 1 means it's open to everyone. */
export const unlockLevel = (part, value) => LEVEL_OF.get(`${part}:${value}`) ?? 1;

/** What one part of an avatar costs in coins. 0 means it's free for everyone. */
export function unlockPrice(part, value) {
  const level = unlockLevel(part, value);
  if (level <= 1) return 0;
  const price = (COINS.price.base + COINS.price.perLevel * level) * (part === 'animal' ? COINS.price.skin : 1);
  return Math.round(price / 10) * 10;
}

/** How an item is named in a player's list of what they own. */
export const itemKey = (part, value) => `${part}:${value}`;

/** The level a whole avatar needs: its most demanding part. */
export function avatarLevel(code) {
  const a = parseAvatar(code);
  return a ? Math.max(unlockLevel('animal', a.animal), unlockLevel('eyes', a.eyes), unlockLevel('bg', a.bg), unlockLevel('extra', a.extra)) : 1;
}

/** The next thing a player on this level will unlock, or null when they have everything. */
export const nextUnlock = (level) => UNLOCKS.find((u) => u.level > level) ?? null;

/** A background as a CSS value, for the colour picker. */
export function backgroundCss(id) {
  const bg = BACKGROUNDS[id];
  return Array.isArray(bg) ? `radial-gradient(circle at 50% 42%, ${bg[0]}, ${bg[1]})` : bg;
}

const INK = '#22243B';
const BLUSH = '#FF8FA3';

// ── Faces ──────────────────────────────────────────────────────

/** A flame rising from an eye at (x, y), about `r` wide on each side. */
const eyeFlame = (x, y, r) => `<path d="M${x - r * 1.15} ${y + r * 0.5} C${x - r * 1.7} ${y - r * 0.7} ${x - r * 0.5} ${y - r} ${x} ${y - r * 3} C${x + r * 0.5} ${y - r} ${x + r * 1.7} ${y - r * 0.7} ${x + r * 1.15} ${y + r * 0.5} Q${x} ${y + r * 1.7} ${x - r * 1.15} ${y + r * 0.5} Z" fill="#FF6A1F"/><path d="M${x - r * 0.65} ${y + r * 0.4} C${x - r} ${y - r * 0.4} ${x - r * 0.25} ${y - r * 0.6} ${x} ${y - r * 1.8} C${x + r * 0.25} ${y - r * 0.6} ${x + r} ${y - r * 0.4} ${x + r * 0.65} ${y + r * 0.4} Q${x} ${y + r} ${x - r * 0.65} ${y + r * 0.4} Z" fill="#FFD23F"/>`;

/** A laser beam from an eye at (x, y) out to the edge of the picture. `s` is 1 for the left eye. */
const eyeBeam = (x, y, s) => `<path d="M${x} ${y} L${x - s * 74} ${y + 30}" stroke="#FF2A2A" stroke-width="7" stroke-linecap="round" opacity=".55"/><path d="M${x} ${y} L${x - s * 74} ${y + 30}" stroke="#FFE3E3" stroke-width="2.4" stroke-linecap="round"/>`;

/**
 * Two eyes at (cx ± dx, y). Most animals have dark eyes with a shine; `sclera` draws a white
 * eyeball around the pupil (owls, frogs, pandas), and `color` changes the closed-eye lines.
 */
function eyes(style, { y, dx, r = 5.1, sclera = 0, color = INK, cx = 60 }) {
  const open = (x) => sclera
    ? `<circle cx="${x}" cy="${y}" r="${sclera}" fill="#fff"/><circle cx="${x}" cy="${y + 0.6}" r="${r}" fill="${INK}"/><circle cx="${x + r * 0.35}" cy="${y - r * 0.35}" r="${r * 0.36}" fill="#fff"/>`
    : `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/><circle cx="${x + r * 0.32}" cy="${y - r * 0.38}" r="${r * 0.34}" fill="#fff"/>`;
  const w = Math.max(r * 1.15, 5);
  const shut = (x) => `${sclera ? `<circle cx="${x}" cy="${y}" r="${sclera}" fill="#fff"/>` : ''}<path d="M${x - w} ${y + 1.5} Q${x} ${y - w * 1.05} ${x + w} ${y + 1.5}" fill="none" stroke="${sclera ? INK : color}" stroke-width="3.2" stroke-linecap="round"/>`;
  const halfBrow = Math.max(sclera || r, 5) + 1.5;
  const browY = y - (sclera || r);
  const brow = (x, s) => `<path d="M${x - s * halfBrow} ${browY - 3} L${x + s * halfBrow} ${browY + 2.5}" stroke="${color}" stroke-width="4.4" stroke-linecap="round"/>`;
  const glowing = (x) => `<circle cx="${x}" cy="${y}" r="${r * 2.2}" fill="#4DF3FF" opacity=".4"/><circle cx="${x}" cy="${y}" r="${r * 1.15}" fill="#E9FFFF"/>`;
  const slit = (x) => `<circle cx="${x}" cy="${y}" r="${Math.max(sclera, r * 1.25)}" fill="#D8F23C"/><ellipse cx="${x}" cy="${y}" rx="${r * 0.32}" ry="${r * 1.15}" fill="${INK}"/>`;
  const hollow = (x) => `<circle cx="${x}" cy="${y}" r="${Math.max(sclera, r * 1.35)}" fill="#07060C"/><circle cx="${x}" cy="${y}" r="${r * 0.42}" fill="#FF3B30"/>`;
  const burning = (x) => `${eyeFlame(x, y, r * 1.15)}<circle cx="${x}" cy="${y}" r="${r * 0.62}" fill="#FFF7D6"/>`;
  const laser = (x, s) => `${eyeBeam(x, y, s)}<circle cx="${x}" cy="${y}" r="${r * 1.2}" fill="#FF3B30"/><circle cx="${x}" cy="${y}" r="${r * 0.55}" fill="#FFE3E3"/>`;
  const [l, rt] = [cx - dx, cx + dx];
  if (style === 'happy') return shut(l) + shut(rt);
  if (style === 'wink') return open(l) + shut(rt);
  if (style === 'angry') return open(l) + open(rt) + brow(l, 1) + brow(rt, -1);
  if (style === 'glow') return glowing(l) + glowing(rt);
  if (style === 'slit') return slit(l) + slit(rt);
  if (style === 'hollow') return hollow(l) + hollow(rt);
  if (style === 'fire') return burning(l) + burning(rt);
  if (style === 'laser') return laser(l, 1) + laser(rt, -1);
  return open(l) + open(rt);
}

/**
 * Narrow eyes tilted towards the nose, for the fierce creatures. `iris` is their everyday colour
 * (and the colour of a shut eye, unless `lid` says otherwise). Without a `pupil` the eye is solid.
 */
function fierce(style, { y, dx, w = 9, h = 5, iris = '#FFB627', pupil = INK, brow = INK, lid = iris, cx = 60 }) {
  // s is 1 for the left eye, whose inner corner points right, and -1 for the right eye.
  const almond = (x, s) => `M${x - s * w} ${y - h} L${x + s * w} ${y + h * 0.7} Q${x} ${y + h * 2} ${x - s * w * 0.9} ${y} Z`;
  const browOver = (x, s, thick = 4) => `<path d="M${x - s * (w + 3)} ${y - h - thick} L${x + s * (w + 3)} ${y + h * 0.4} L${x - s * (w + 1)} ${y - h + 1} Z" fill="${brow}"/>`;
  const halo = (x, color) => `<ellipse cx="${x}" cy="${y + h * 0.3}" rx="${w * 1.8}" ry="${h * 2.6}" fill="${color}" opacity=".38"/>`;
  const eye = (x, s) => {
    if (style === 'glow') return `${halo(x, '#4DF3FF')}<path d="${almond(x, s)}" fill="#E9FFFF"/>${browOver(x, s)}`;
    if (style === 'angry') return `${halo(x, '#FF2A2A')}<path d="${almond(x, s)}" fill="#FF3B30"/><circle cx="${x + s * 1.5}" cy="${y + h * 0.45}" r="${h * 0.42}" fill="${INK}"/>${browOver(x, s, 6)}`;
    if (style === 'slit') return `<path d="${almond(x, s)}" fill="#D8F23C"/><ellipse cx="${x + s}" cy="${y + h * 0.4}" rx="${Math.max(1.5, w * 0.16)}" ry="${h * 1.25}" fill="${INK}"/>${browOver(x, s)}`;
    if (style === 'hollow') return `<path d="${almond(x, s)}" fill="#07060C"/><circle cx="${x + s * 1.5}" cy="${y + h * 0.45}" r="${h * 0.38}" fill="#FF3B30"/>${browOver(x, s)}`;
    if (style === 'fire') return `${eyeFlame(x, y, w * 0.62)}<path d="${almond(x, s)}" fill="#FFF3B0"/>${browOver(x, s)}`;
    if (style === 'laser') return `${eyeBeam(x, y + h * 0.3, s)}<path d="${almond(x, s)}" fill="#FF3B30"/><circle cx="${x + s * 1.5}" cy="${y + h * 0.45}" r="${h * 0.45}" fill="#FFE3E3"/>${browOver(x, s)}`;
    const middle = pupil
      ? `<circle cx="${x + s * 1.5}" cy="${y + h * 0.45}" r="${h * 0.62}" fill="${pupil}"/>`
      : `<ellipse cx="${x - s * w * 0.25}" cy="${y + h * 0.1}" rx="${w * 0.22}" ry="${h * 0.3}" fill="#fff" opacity=".75"/>`;
    return `<path d="${almond(x, s)}" fill="${iris}"/>${middle}${browOver(x, s)}`;
  };
  const shut = (x, s) => `<path d="M${x - s * w} ${y - h * 0.4} L${x + s * w} ${y + h * 0.7}" stroke="${lid}" stroke-width="4" stroke-linecap="round"/>`;
  const [l, r] = [cx - dx, cx + dx];
  if (style === 'happy') return shut(l, 1) + shut(r, -1);
  if (style === 'wink') return eye(l, 1) + shut(r, -1);
  return eye(l, 1) + eye(r, -1);
}

/** An open, snarling mouth at height y, with fangs above and below. */
function snarl(y, w, h, { inside = '#3A0B16', tooth = '#FFFDF5' } = {}) {
  const fang = (x, top, len, half) => `M${x - half} ${top} L${x} ${top + len} L${x + half} ${top} Z`;
  const mouth = `M${60 - w} ${y} Q60 ${y - h * 0.35} ${60 + w} ${y} Q${60 + w * 0.7} ${y + h} 60 ${y + h} Q${60 - w * 0.7} ${y + h} ${60 - w} ${y} Z`;
  const top = y - h * 0.12;
  const bottom = y + h * 0.98;
  return `<path d="${mouth}" fill="${inside}"/><path d="${fang(60 - w * 0.58, top, h * 0.8, w * 0.2)} ${fang(60 + w * 0.58, top, h * 0.8, w * 0.2)} ${fang(60 - w * 0.2, y - h * 0.22, h * 0.34, w * 0.14)} ${fang(60 + w * 0.2, y - h * 0.22, h * 0.34, w * 0.14)} ${fang(60 - w * 0.3, bottom, -h * 0.42, w * 0.14)} ${fang(60 + w * 0.3, bottom, -h * 0.42, w * 0.14)}" fill="${tooth}"/>`;
}

const cheeks = (y, dx, r = 5.5) =>
  `<circle cx="${60 - dx}" cy="${y}" r="${r}" fill="${BLUSH}" opacity=".55"/><circle cx="${60 + dx}" cy="${y}" r="${r}" fill="${BLUSH}" opacity=".55"/>`;

const smile = (y, w = 5, color = INK) =>
  `<path d="M${60 - w} ${y} Q${60 - w / 2} ${y + 4} 60 ${y} Q${60 + w / 2} ${y + 4} ${60 + w} ${y}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;

// ── Animals ────────────────────────────────────────────────────
// Each draws its head on a 120×120 canvas and says where its eyes and the top of its head
// are, so glasses and hats sit in the right place. `body` colours the shoulders.

const A = {
  cat: {
    body: '#F29A3E',
    anchor: { eyeY: 64, dx: 13, top: 36, half: 34 },
    draw: (e) => `
      <path d="M29 56 L33 20 L57 38 Z M91 56 L87 20 L63 38 Z" fill="#F29A3E" stroke="#F29A3E" stroke-width="7" stroke-linejoin="round"/>
      <path d="M35 46 L37 29 L49 39 Z M85 46 L83 29 L71 39 Z" fill="#FFB8B8" stroke="#FFB8B8" stroke-width="3" stroke-linejoin="round"/>
      <ellipse cx="60" cy="68" rx="35" ry="31" fill="#F7A84B"/>
      <path d="M60 38 v9 M51 40 l2 7 M69 40 l-2 7" stroke="#DE7A22" stroke-width="4" stroke-linecap="round"/>
      <ellipse cx="52" cy="81" rx="9" ry="7" fill="#FFEBD3"/><ellipse cx="68" cy="81" rx="9" ry="7" fill="#FFEBD3"/>
      ${cheeks(76, 23)}
      <path d="M56 75 h8 l-4 4.5 Z" fill="#F0708A" stroke="#F0708A" stroke-width="2" stroke-linejoin="round"/>
      ${smile(81, 5)}
      <path d="M40 79 h-12 M40 84 l-11 3 M80 79 h12 M80 84 l11 3" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".9"/>
      ${eyes(e, { y: 64, dx: 13 })}`,
  },
  fox: {
    body: '#EE7A30',
    anchor: { eyeY: 64, dx: 14, top: 38, half: 36 },
    draw: (e) => `
      <path d="M27 58 L30 16 L56 38 Z M93 58 L90 16 L64 38 Z" fill="#EE7A30" stroke="#EE7A30" stroke-width="6" stroke-linejoin="round"/>
      <path d="M33 46 L34 25 L47 37 Z M87 46 L86 25 L73 37 Z" fill="#3A2B33" stroke="#3A2B33" stroke-width="3" stroke-linejoin="round"/>
      <path d="M60 100 C50 100 26 86 22 72 C19 58 34 38 60 38 C86 38 101 58 98 72 C94 86 70 100 60 100 Z" fill="#F4843A"/>
      <path d="M60 100 C52 100 34 88 26 76 C38 72 50 76 60 84 C70 76 82 72 94 76 C86 88 68 100 60 100 Z" fill="#FFF6EC"/>
      ${cheeks(78, 25, 5)}
      <ellipse cx="60" cy="86" rx="5" ry="3.6" fill="${INK}"/>
      ${smile(91, 4)}
      ${eyes(e, { y: 64, dx: 14 })}`,
  },
  bear: {
    body: '#9C6239',
    anchor: { eyeY: 63, dx: 14, top: 34, half: 34 },
    draw: (e) => `
      <circle cx="32" cy="40" r="13" fill="#A2683F"/><circle cx="88" cy="40" r="13" fill="#A2683F"/>
      <circle cx="32" cy="40" r="7" fill="#D99E74"/><circle cx="88" cy="40" r="7" fill="#D99E74"/>
      <circle cx="60" cy="67" r="34" fill="#AA7046"/>
      <ellipse cx="60" cy="81" rx="16" ry="12.5" fill="#EBCBA4"/>
      ${cheeks(75, 24)}
      <ellipse cx="60" cy="75.5" rx="6.5" ry="4.6" fill="${INK}"/>
      <path d="M60 80 v3.5" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
      ${smile(83.5, 5.5)}
      ${eyes(e, { y: 63, dx: 14 })}`,
  },
  panda: {
    body: '#2A2C40',
    anchor: { eyeY: 64, dx: 13, top: 35, half: 35 },
    draw: (e) => `
      <circle cx="33" cy="40" r="12.5" fill="#2A2C40"/><circle cx="87" cy="40" r="12.5" fill="#2A2C40"/>
      <ellipse cx="60" cy="67" rx="35" ry="32" fill="#FBFBF7"/>
      <ellipse cx="47" cy="65" rx="9.5" ry="12" transform="rotate(38 47 65)" fill="#2A2C40"/>
      <ellipse cx="73" cy="65" rx="9.5" ry="12" transform="rotate(-38 73 65)" fill="#2A2C40"/>
      ${cheeks(79, 24)}
      <ellipse cx="60" cy="78" rx="5.5" ry="3.8" fill="#2A2C40"/>
      ${smile(83, 5)}
      ${eyes(e, { y: 64, dx: 13, r: 3.2, sclera: 5.2, color: '#fff' })}`,
  },
  koala: {
    body: '#8F99AC',
    anchor: { eyeY: 62, dx: 15, top: 38, half: 33 },
    draw: (e) => `
      <circle cx="27" cy="50" r="18" fill="#9DA6B8"/><circle cx="93" cy="50" r="18" fill="#9DA6B8"/>
      <circle cx="28" cy="51" r="11" fill="#EEF0F5"/><circle cx="92" cy="51" r="11" fill="#EEF0F5"/>
      <ellipse cx="60" cy="69" rx="32" ry="30" fill="#A8B0C1"/>
      <ellipse cx="60" cy="84" rx="18" ry="11" fill="#C4CAD6"/>
      ${cheeks(76, 23)}
      <rect x="51.5" y="64" width="17" height="22" rx="8.5" fill="#3B3F55"/>
      <ellipse cx="57" cy="69" rx="2.5" ry="3.5" fill="#fff" opacity=".35"/>
      ${smile(91, 4.5)}
      ${eyes(e, { y: 62, dx: 17 })}`,
  },
  rabbit: {
    body: '#E6E2EF',
    anchor: { eyeY: 68, dx: 12, top: 46, half: 31 },
    draw: (e) => `
      <ellipse cx="45" cy="28" rx="9.5" ry="25" transform="rotate(-12 45 28)" fill="#F4F2F8"/>
      <ellipse cx="75" cy="28" rx="9.5" ry="25" transform="rotate(12 75 28)" fill="#F4F2F8"/>
      <ellipse cx="45" cy="30" rx="4.5" ry="18" transform="rotate(-12 45 30)" fill="#FFB8CC"/>
      <ellipse cx="75" cy="30" rx="4.5" ry="18" transform="rotate(12 75 30)" fill="#FFB8CC"/>
      <ellipse cx="60" cy="74" rx="31" ry="28" fill="#F7F5FA"/>
      <ellipse cx="53" cy="84" rx="8" ry="6" fill="#ECE8F2"/><ellipse cx="67" cy="84" rx="8" ry="6" fill="#ECE8F2"/>
      ${cheeks(80, 21)}
      <path d="M56 78.5 h8 l-4 4 Z" fill="#F57A9A" stroke="#F57A9A" stroke-width="2" stroke-linejoin="round"/>
      <path d="M60 83 v2.5" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
      <rect x="56.5" y="85.5" width="7" height="6" rx="1.6" fill="#fff" stroke="#D9D4E3" stroke-width="1.2"/>
      <path d="M60 85.5 v6" stroke="#D9D4E3" stroke-width="1"/>
      ${eyes(e, { y: 68, dx: 12 })}`,
  },
  owl: {
    body: '#7E5434',
    anchor: { eyeY: 60, dx: 14, top: 36, half: 34, glassR: 12 },
    draw: (e) => `
      <path d="M27 44 L33 22 L48 36 Q60 32 72 36 L87 22 L93 44 Q101 66 94 86 Q84 106 60 106 Q36 106 26 86 Q19 66 27 44 Z" fill="#8B5E3C" stroke="#8B5E3C" stroke-width="4" stroke-linejoin="round"/>
      <path d="M38 84 Q60 104 82 84 Q82 104 60 106 Q38 104 38 84 Z" fill="#C99A6B"/>
      <path d="M48 92 q3 3 6 0 M57 95 q3 3 6 0 M66 92 q3 3 6 0" fill="none" stroke="#A9784C" stroke-width="2" stroke-linecap="round"/>
      <circle cx="46" cy="60" r="14" fill="#FFF1D9"/><circle cx="74" cy="60" r="14" fill="#FFF1D9"/>
      ${cheeks(76, 26, 4.5)}
      <path d="M54.5 69 h11 l-5.5 9 Z" fill="#F7A531" stroke="#F7A531" stroke-width="2.5" stroke-linejoin="round"/>
      ${eyes(e, { y: 60, dx: 14, r: 6.2, sclera: 0 })}`,
  },
  penguin: {
    body: '#28325A',
    anchor: { eyeY: 64, dx: 12, top: 33, half: 34 },
    draw: (e) => `
      <ellipse cx="60" cy="67" rx="35" ry="34" fill="#2E3A66"/>
      <circle cx="48" cy="67" r="17" fill="#FBFBF7"/><circle cx="72" cy="67" r="17" fill="#FBFBF7"/>
      <ellipse cx="60" cy="82" rx="23" ry="16" fill="#FBFBF7"/>
      ${cheeks(77, 22, 5)}
      <path d="M52 74 Q60 69 68 74 Q60 83 52 74 Z" fill="#F7A531" stroke="#F7A531" stroke-width="2" stroke-linejoin="round"/>
      <path d="M53.5 74.5 Q60 77 66.5 74.5" fill="none" stroke="#D9861A" stroke-width="1.4" stroke-linecap="round"/>
      ${eyes(e, { y: 64, dx: 12 })}`,
  },
  frog: {
    body: '#4FB463',
    anchor: { eyeY: 44, dx: 18, top: 30, half: 38, glassR: 12 },
    draw: (e) => `
      <circle cx="42" cy="44" r="15" fill="#5CC46E"/><circle cx="78" cy="44" r="15" fill="#5CC46E"/>
      <ellipse cx="60" cy="72" rx="39" ry="28" fill="#5CC46E"/>
      <ellipse cx="60" cy="86" rx="26" ry="12" fill="#B9EBAE"/>
      ${cheeks(76, 27, 6)}
      <circle cx="56" cy="66" r="1.8" fill="#2E7A3C"/><circle cx="64" cy="66" r="1.8" fill="#2E7A3C"/>
      <path d="M40 76 Q60 94 80 76" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
      ${eyes(e, { y: 44, dx: 18, r: 5, sclera: 9.5 })}`,
  },
  lion: {
    body: '#D9822B',
    anchor: { eyeY: 63, dx: 11, top: 22, half: 30 },
    draw: (e) => {
      const mane = Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return `<circle cx="${(60 + Math.cos(a) * 33).toFixed(1)}" cy="${(64 + Math.sin(a) * 33).toFixed(1)}" r="13" fill="${i % 2 ? '#E38B2F' : '#D27525'}"/>`;
      }).join('');
      return `
      ${mane}<circle cx="60" cy="64" r="36" fill="#E38B2F"/>
      <circle cx="39" cy="42" r="8" fill="#F5C064"/><circle cx="81" cy="42" r="8" fill="#F5C064"/>
      <circle cx="39" cy="42" r="4" fill="#E09A4A"/><circle cx="81" cy="42" r="4" fill="#E09A4A"/>
      <circle cx="60" cy="67" r="27" fill="#F8C86A"/>
      <ellipse cx="53.5" cy="79" rx="8.5" ry="6.5" fill="#FFE8BE"/><ellipse cx="66.5" cy="79" rx="8.5" ry="6.5" fill="#FFE8BE"/>
      ${cheeks(75, 19, 4.5)}
      <path d="M55 72.5 h10 l-5 5.5 Z" fill="#7A4A2A" stroke="#7A4A2A" stroke-width="2.5" stroke-linejoin="round"/>
      ${smile(83, 5)}
      ${eyes(e, { y: 63, dx: 11, r: 4.7 })}`;
    },
  },
  dog: {
    body: '#D9A46A',
    anchor: { eyeY: 62, dx: 13, top: 36, half: 32 },
    draw: (e) => `
      <ellipse cx="60" cy="66" rx="31" ry="30" fill="#E8B87F"/>
      <ellipse cx="72.5" cy="61" rx="10.5" ry="9.5" fill="#C98B4E"/>
      <path d="M34 42 C20 44 14 68 21 84 C27 90 35 80 38 68 C40 58 40 48 34 42 Z" fill="#8E5530"/>
      <path d="M86 42 C100 44 106 68 99 84 C93 90 85 80 82 68 C80 58 80 48 86 42 Z" fill="#8E5530"/>
      <ellipse cx="60" cy="80" rx="15" ry="11.5" fill="#FFF3E2"/>
      ${cheeks(76, 22)}
      <ellipse cx="60" cy="74.5" rx="6.8" ry="4.8" fill="${INK}"/>
      <ellipse cx="58" cy="73.2" rx="2" ry="1.2" fill="#fff" opacity=".5"/>
      <path d="M60 79 v3" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M58 85 h6 v4 a3 3 0 0 1 -6 0 Z" fill="#F2727F"/>
      ${smile(82.5, 5.5)}
      ${eyes(e, { y: 62, dx: 13 })}`,
  },
  monkey: {
    body: '#8A5636',
    anchor: { eyeY: 62, dx: 11, top: 30, half: 32 },
    draw: (e) => `
      <circle cx="26" cy="64" r="12.5" fill="#94603F"/><circle cx="94" cy="64" r="12.5" fill="#94603F"/>
      <circle cx="26" cy="64" r="7" fill="#F0BC97"/><circle cx="94" cy="64" r="7" fill="#F0BC97"/>
      <circle cx="60" cy="63" r="33" fill="#94603F"/>
      <path d="M60 40 c-3 -6 2 -10 6 -8" fill="none" stroke="#94603F" stroke-width="5" stroke-linecap="round"/>
      <circle cx="49" cy="62" r="13" fill="#F6CFAA"/><circle cx="71" cy="62" r="13" fill="#F6CFAA"/>
      <ellipse cx="60" cy="79" rx="21" ry="15" fill="#F6CFAA"/>
      ${cheeks(76, 22, 4.5)}
      <circle cx="57" cy="74" r="1.7" fill="#8A5636"/><circle cx="63" cy="74" r="1.7" fill="#8A5636"/>
      <path d="M50 81 Q60 90 70 81" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
      ${eyes(e, { y: 62, dx: 11, r: 4.7 })}`,
  },

  // Fierce creatures, unlocked with levels: sharper shapes and darker colours than the animals above.
  wolf: {
    body: '#2F3644',
    anchor: { eyeY: 58, dx: 17, top: 32, half: 34 },
    draw: (e) => `
      <path d="M34 54 L26 6 L56 34 Z M86 54 L94 6 L64 34 Z" fill="#454E60" stroke="#454E60" stroke-width="3" stroke-linejoin="round"/>
      <path d="M38 44 L33 20 L50 36 Z M82 44 L87 20 L70 36 Z" fill="#9C3F5C"/>
      <path d="M60 30 L80 34 L96 54 L108 76 L94 76 L98 92 L80 90 L72 106 L60 110 L48 106 L40 90 L22 92 L26 76 L12 76 L24 54 L40 34 Z" fill="#6E788D"/>
      <path d="M60 30 L80 34 L98 58 L76 58 L60 78 L44 58 L22 58 L40 34 Z" fill="#3A4254"/>
      <path d="M60 62 L76 74 L74 96 L60 108 L46 96 L44 74 Z" fill="#E8ECF4"/>
      <path d="M51 71 H69 L60 81 Z" fill="${INK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      ${snarl(88, 14, 14)}
      ${fierce(e, { y: 58, dx: 17, iris: '#FFB627', brow: '#191D2B' })}`,
  },
  ninja: {
    body: '#171A28',
    anchor: { eyeY: 64, dx: 15, top: 32, half: 35 },
    draw: (e) => `
      <path d="M90 44 C102 40 112 46 118 32 C116 56 104 60 90 58 Z M90 52 C104 56 110 66 119 60 C113 80 102 76 88 64 Z" fill="#E0263C"/>
      <circle cx="60" cy="66" r="38" fill="#262B44"/>
      <path d="M24 74 Q60 92 96 74 Q96 106 60 108 Q24 106 24 74 Z" fill="#171A28"/>
      <path d="M36 92 Q60 104 84 92 M42 100 Q60 108 78 100" fill="none" stroke="#2F3552" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M25 58 Q60 48 95 58 L93 78 Q60 88 27 78 Z" fill="#EDBE93"/>
      <path d="M25 50 Q60 38 95 50 L95 60 Q60 48 25 60 Z" fill="#E0263C"/>
      <rect x="48" y="40" width="24" height="14" rx="2.5" fill="#C4CCDA" stroke="#7C879C" stroke-width="1.6"/>
      <path d="M60 42.5 L62.5 47 L67 47 L62.5 47 L60 51.5 L57.5 47 L53 47 L57.5 47 Z" fill="#3A4254" stroke="#3A4254" stroke-width="1.6" stroke-linejoin="round"/>
      ${fierce(e, { y: 66, dx: 15, iris: '#fff', lid: INK, brow: '#1A1D2E' })}`,
  },
  shark: {
    body: '#46627F',
    anchor: { eyeY: 56, dx: 29, top: 32, half: 40, glassR: 11 },
    draw: (e) => `
      <path d="M60 2 L76 40 L44 40 Z" fill="#587492" stroke="#587492" stroke-width="3" stroke-linejoin="round"/>
      <path d="M60 28 C92 28 110 56 106 76 C102 100 80 112 60 112 C40 112 18 100 14 76 C10 56 28 28 60 28 Z" fill="#7596B8"/>
      <path d="M60 28 C92 28 110 56 106 76 C100 68 80 66 60 66 Z" fill="#6585A7"/>
      <path d="M15 78 C30 68 90 68 105 78 C101 101 80 112 60 112 C40 112 19 101 15 78 Z" fill="#F1F5FA"/>
      <path d="M27 76 Q60 62 93 76 Q87 106 60 108 Q33 106 27 76 Z" fill="#4A0E1A"/>
      <path d="M28 76 L34 87 L39 72.5 L45 86 L50 70.5 L55 85 L60 70 L65 85 L70 70.5 L75 86 L81 72.5 L86 87 L92 76 Q60 62 28 76 Z" fill="#FFFDF5"/>
      <path d="M36 98 L41 88 L46 100 L52 90 L56 103 L60 92 L64 103 L68 90 L74 100 L79 88 L84 98 Q75 107 60 108 Q45 107 36 98 Z" fill="#FFFDF5"/>
      ${fierce(e, { y: 56, dx: 30, w: 8, h: 4.2, iris: '#10131F', pupil: null, lid: INK, brow: '#2F4663' })}`,
  },
  cobra: {
    body: '#174F34',
    anchor: { eyeY: 56, dx: 14, top: 34, half: 26 },
    draw: (e) => `
      <path d="M60 12 C92 12 112 44 106 78 C101 102 80 118 60 118 C40 118 19 102 14 78 C8 44 28 12 60 12 Z" fill="#1F6B45"/>
      <path d="M60 24 C84 24 99 50 94 78 C90 97 73 110 60 110 C47 110 30 97 26 78 C21 50 36 24 60 24 Z" fill="#E8C547"/>
      <path d="M30 56 L40 60 M26 72 L38 72 M32 90 L42 84 M90 56 L80 60 M94 72 L82 72 M88 90 L78 84" stroke="#1F6B45" stroke-width="5" stroke-linecap="round"/>
      <path d="M60 32 C77 32 86 44 84 58 C82 74 72 90 60 94 C48 90 38 74 36 58 C34 44 43 32 60 32 Z" fill="#35B071"/>
      <path d="M60 32 C70 32 78 37 82 46 C74 44 66 48 60 56 C54 48 46 44 38 46 C42 37 50 32 60 32 Z" fill="#238A55"/>
      <circle cx="56" cy="65" r="1.6" fill="#174F34"/><circle cx="64" cy="65" r="1.6" fill="#174F34"/>
      <path d="M45 72 Q60 66 75 72 Q71 91 60 95 Q49 91 45 72 Z" fill="#5A0F22"/>
      <path d="M49 72 L53 90 L57 71 Z M63 71 L67 90 L71 72 Z" fill="#FFFDF5"/>
      <path d="M60 84 V102 M60 102 L54 111 M60 102 L66 111" fill="none" stroke="#F0314A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${fierce(e, { y: 56, dx: 14, w: 8, h: 4.2, iris: '#FFD23F', brow: '#143F2A' })}`,
  },
  robot: {
    body: '#3F4A60',
    anchor: { eyeY: 59, dx: 15, top: 28, half: 34 },
    draw: (e) => `
      <path d="M60 30 V14" stroke="#7C889F" stroke-width="4.5" stroke-linecap="round"/>
      <circle cx="60" cy="10" r="9" fill="#FF3B4E" opacity=".3"/><circle cx="60" cy="10" r="5" fill="#FF3B4E"/>
      <rect x="15" y="54" width="14" height="28" rx="4" fill="#5B667E"/><rect x="91" y="54" width="14" height="28" rx="4" fill="#5B667E"/>
      <rect x="25" y="28" width="70" height="76" rx="15" fill="#B4BFD2"/>
      <path d="M60 28 H80 Q95 28 95 43 V89 Q95 104 80 104 H60 Z" fill="#9AA6BC"/>
      <path d="M25 80 H95 V89 Q95 104 80 104 H40 Q25 104 25 89 Z" fill="#7C889F"/>
      <circle cx="33" cy="37" r="2.5" fill="#5B667E"/><circle cx="87" cy="37" r="2.5" fill="#5B667E"/>
      <rect x="31" y="45" width="58" height="29" rx="13" fill="#0C1124"/>
      <rect x="42" y="84" width="36" height="13" rx="3" fill="#20283D"/>
      <path d="M50 84 V97 M60 84 V97 M70 84 V97" stroke="#7C889F" stroke-width="2.4"/>
      ${fierce(e, { y: 58, dx: 15, w: 9, h: 4.6, iris: '#39E6FF', pupil: null, brow: '#0C1124' })}`,
  },
  tiger: {
    body: '#C96A12',
    anchor: { eyeY: 60, dx: 16, top: 32, half: 38 },
    draw: (e) => `
      <circle cx="30" cy="36" r="14" fill="#E57A12"/><circle cx="90" cy="36" r="14" fill="#E57A12"/>
      <circle cx="30" cy="36" r="7.5" fill="#2A1A12"/><circle cx="90" cy="36" r="7.5" fill="#2A1A12"/>
      <path d="M60 28 C86 28 104 46 104 68 C104 84 94 94 86 100 C78 108 68 112 60 112 C52 112 42 108 34 100 C26 94 16 84 16 68 C16 46 34 28 60 28 Z" fill="#F58A1F"/>
      <path d="M16 70 C24 80 34 84 46 84 L44 106 C30 100 18 88 16 70 Z M104 70 C96 80 86 84 74 84 L76 106 C90 100 102 88 104 70 Z" fill="#FFF3E0"/>
      <ellipse cx="44" cy="54" rx="11" ry="6" fill="#FFF3E0"/><ellipse cx="76" cy="54" rx="11" ry="6" fill="#FFF3E0"/>
      <path d="M60 28 L55 48 L60 56 L65 48 Z M44 31 L47 47 L53 42 Z M76 31 L73 47 L67 42 Z M30 44 L40 50 L33 56 Z M90 44 L80 50 L87 56 Z M16 62 L34 66 L19 72 Z M104 62 L86 66 L101 72 Z M20 80 L36 78 L28 90 Z M100 80 L84 78 L92 90 Z" fill="#231610"/>
      <ellipse cx="60" cy="88" rx="24" ry="18" fill="#FFF3E0"/>
      <path d="M52 70 H68 L60 80 Z" fill="#E0556B" stroke="#E0556B" stroke-width="2.5" stroke-linejoin="round"/>
      ${snarl(86, 17, 17, { inside: '#6B1420' })}
      ${fierce(e, { y: 60, dx: 16, iris: '#FFD23F', brow: '#231610' })}`,
  },
  bull: {
    body: '#2C1F1C',
    anchor: { eyeY: 62, dx: 18, top: 30, half: 32 },
    draw: (e) => `
      <path d="M36 42 C14 42 3 24 10 5 C16 22 28 28 46 30 Z M84 42 C106 42 117 24 110 5 C104 22 92 28 74 30 Z" fill="#EFE3CC"/>
      <path d="M10 5 C7 14 7 22 11 29 C13 25 15 21 17 18 C13 14 11 10 10 5 Z M110 5 C113 14 113 22 109 29 C107 25 105 21 103 18 C107 14 109 10 110 5 Z" fill="#3A2A26"/>
      <path d="M27 50 L8 56 L26 68 Z M93 50 L112 56 L94 68 Z" fill="#2C1F1C"/>
      <path d="M38 28 H82 L97 58 L85 96 Q60 116 35 96 L23 58 Z" fill="#54392F"/>
      <path d="M38 28 H82 L94 52 L72 58 L60 74 L48 58 L26 52 Z" fill="#3A2822"/>
      <path d="M44 30 L50 15 L56 27 L62 12 L66 27 L74 17 L76 31 Z" fill="#231714"/>
      <ellipse cx="60" cy="92" rx="28" ry="19" fill="#94695A"/>
      <ellipse cx="49" cy="90" rx="6" ry="4.6" fill="#231714"/><ellipse cx="71" cy="90" rx="6" ry="4.6" fill="#231714"/>
      <path d="M50 100 a10 10 0 0 0 20 0" fill="none" stroke="#FFC531" stroke-width="5" stroke-linecap="round"/>
      ${fierce(e, { y: 60, dx: 18, iris: '#FF3B30', pupil: '#231714', brow: '#1A100E' })}`,
  },
  alien: {
    body: '#3E7D3A',
    anchor: { eyeY: 60, dx: 20, top: 24, half: 36, glassR: 14 },
    draw: (e) => `
      <path d="M60 20 C92 20 106 44 100 66 C94 90 72 112 60 112 C48 112 26 90 20 66 C14 44 28 20 60 20 Z" fill="#8FD86A"/>
      <path d="M60 20 C92 20 106 44 100 66 C94 90 72 112 60 112 Z" fill="#7CC659"/>
      <path d="M44 30 Q60 24 76 30" fill="none" stroke="#B8EE97" stroke-width="3" stroke-linecap="round"/>
      <circle cx="56" cy="82" r="1.8" fill="#3E7D3A"/><circle cx="64" cy="82" r="1.8" fill="#3E7D3A"/>
      <path d="M52 95 Q60 91 68 95" fill="none" stroke="#3E7D3A" stroke-width="3" stroke-linecap="round"/>
      ${fierce(e, { y: 60, dx: 20, w: 15, h: 8.5, iris: '#0B0F14', pupil: null, lid: '#21301A', brow: '#7CC659' })}`,
  },
  knight: {
    body: '#6F7C94',
    anchor: { eyeY: 63, dx: 16, top: 24, half: 36 },
    draw: (e) => `
      <path d="M58 30 C52 8 78 -2 112 10 C92 12 88 22 84 40 Z" fill="#E0263C"/>
      <path d="M70 24 C76 14 90 10 104 12" fill="none" stroke="#A81526" stroke-width="3" stroke-linecap="round"/>
      <path d="M60 18 C86 18 97 38 97 62 V92 Q97 106 76 110 H44 Q23 106 23 92 V62 C23 38 34 18 60 18 Z" fill="#C2CCDC"/>
      <path d="M60 18 C86 18 97 38 97 62 V92 Q97 106 76 110 H60 Z" fill="#94A1B8"/>
      <rect x="56" y="18" width="8" height="38" fill="#E4E9F1"/>
      <path d="M28 54 H92 L88 72 H67 V92 H53 V72 H32 Z" fill="#0E1222"/>
      <path d="M34 82 h6 M34 90 h6 M36 98 h6 M80 82 h6 M80 90 h6 M78 98 h6" stroke="#5B667E" stroke-width="3" stroke-linecap="round"/>
      ${fierce(e, { y: 62, dx: 17, w: 9, h: 4.4, iris: '#FFB627', pupil: null, brow: '#0E1222' })}`,
  },
  panther: {
    body: '#10111A',
    anchor: { eyeY: 60, dx: 16, top: 32, half: 37 },
    draw: (e) => `
      <path d="M31 50 L29 18 L54 36 Z M89 50 L91 18 L66 36 Z" fill="#12131C" stroke="#4A4F70" stroke-width="2" stroke-linejoin="round"/>
      <path d="M36 42 L35 27 L47 36 Z M84 42 L85 27 L73 36 Z" fill="#5B2A62"/>
      <path d="M60 32 C86 32 99 48 99 66 L91 88 L74 105 Q60 113 46 105 L29 88 L21 66 C21 48 34 32 60 32 Z" fill="#1E2030" stroke="#4A4F70" stroke-width="2"/>
      <path d="M60 68 L77 80 L73 99 L60 106 L47 99 L43 80 Z" fill="#2E3146"/>
      <path d="M53 71 H67 L60 79 Z" fill="#05060C" stroke="#05060C" stroke-width="2" stroke-linejoin="round"/>
      <path d="M41 86 L24 82 M41 92 L26 96 M79 86 L96 82 M79 92 L94 96" stroke="#7E84A8" stroke-width="1.6" stroke-linecap="round"/>
      ${snarl(88, 13, 13)}
      ${fierce(e, { y: 60, dx: 16, iris: '#B6FF3C', brow: '#07080F' })}`,
  },
  fiend: {
    body: '#6E0C1B',
    anchor: { eyeY: 62, dx: 16, top: 30, half: 34 },
    draw: (e) => `
      <path d="M36 46 C22 32 20 14 31 1 C34 16 43 27 52 32 Z M84 46 C98 32 100 14 89 1 C86 16 77 27 68 32 Z" fill="#1B1520"/>
      <path d="M31 1 C27 7 25 13 25 19 C28 17 31 16 34 15 C32 11 31 6 31 1 Z M89 1 C93 7 95 13 95 19 C92 17 89 16 86 15 C88 11 89 6 89 1 Z" fill="#FF7A1F"/>
      <path d="M25 56 L5 42 L24 76 Z M95 56 L115 42 L96 76 Z" fill="#A81526"/>
      <path d="M60 28 C83 28 99 44 99 64 L89 92 L72 108 L60 114 L48 108 L31 92 L21 64 C21 44 37 28 60 28 Z" fill="#D81E33"/>
      <path d="M60 28 C83 28 99 44 99 64 L89 92 L72 108 L60 114 Z" fill="#BC1729"/>
      <path d="M26 52 L60 66 L94 52 L90 42 L60 55 L30 42 Z" fill="#7E0E1E"/>
      <path d="M30 76 L44 84 M90 76 L76 84" stroke="#7E0E1E" stroke-width="4" stroke-linecap="round"/>
      <path d="M36 84 Q60 98 84 84 Q81 104 60 108 Q39 104 36 84 Z" fill="#26060D"/>
      <path d="M37 85 L43 96 L47 89 L52 100 L56 92 L60 103 L64 92 L68 100 L73 89 L77 96 L83 85 Q60 98 37 85 Z" fill="#FFFDF5"/>
      <path d="M55 110 L60 122 L65 110 Z" fill="#1B1520"/>
      ${fierce(e, { y: 63, dx: 16, iris: '#FFD23F', brow: '#3F0710' })}`,
  },
  skull: {
    body: '#191722',
    anchor: { eyeY: 63, dx: 19, top: 22, half: 38, glassR: 12 },
    draw: (e) => `
      <path d="M60 18 C90 18 104 42 102 64 C101 77 93 85 85 88 V100 Q85 106 79 106 H41 Q35 106 35 100 V88 C27 85 19 77 18 64 C16 42 30 18 60 18 Z" fill="#F4EFE2"/>
      <path d="M60 18 C90 18 104 42 102 64 C101 77 93 85 85 88 V100 Q85 106 79 106 H60 Z" fill="#DAD3C1"/>
      <path d="M26 58 Q40 44 55 60 Q53 80 38 78 Q26 74 26 58 Z M94 58 Q80 44 65 60 Q67 80 82 78 Q94 74 94 58 Z" fill="#14121C"/>
      <path d="M60 70 L53 86 H67 Z" fill="#14121C" stroke="#14121C" stroke-width="2" stroke-linejoin="round"/>
      <path d="M46 92 V106 M53 92 V106 M60 92 V106 M67 92 V106 M74 92 V106" stroke="#8A8472" stroke-width="2.4"/>
      <path d="M76 22 L71 33 L78 40 L72 50" fill="none" stroke="#8A8472" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      ${fierce(e, { y: 63, dx: 19, w: 8, h: 4.2, iris: '#FF3B30', pupil: null, brow: '#14121C' })}`,
  },
  phoenix: {
    body: '#B3201A',
    anchor: { eyeY: 62, dx: 16, top: 34, half: 32 },
    draw: (e) => `
      <path d="M60 0 C66 16 78 8 81 0 C84 18 98 18 105 12 C101 32 110 38 118 38 C105 50 105 60 112 72 L60 96 L8 72 C15 60 15 50 2 38 C10 38 19 32 15 12 C22 18 36 18 39 0 C42 8 54 16 60 0 Z" fill="#FF5A1F"/>
      <path d="M60 14 C63 26 74 20 77 14 C78 28 90 28 94 26 C92 40 98 46 102 48 C94 56 94 64 98 72 L60 90 L22 72 C26 64 26 56 18 48 C22 46 28 40 26 26 C30 28 42 28 43 14 C46 20 57 26 60 14 Z" fill="#FFC531"/>
      <path d="M60 36 C80 36 93 50 91 68 C89 85 75 99 60 110 C45 99 31 85 29 68 C27 50 40 36 60 36 Z" fill="#E8361F"/>
      <path d="M60 36 C80 36 93 50 91 68 C89 85 75 99 60 110 Z" fill="#C92A17"/>
      <path d="M38 76 Q60 62 82 76 Q74 92 60 100 Q46 92 38 76 Z" fill="#FF8A2A"/>
      <path d="M48 72 Q60 64 72 72 L60 100 Z" fill="#FFD23F" stroke="#FFD23F" stroke-width="2" stroke-linejoin="round"/>
      <path d="M60 67 Q72 66 72 72 L60 100 Z" fill="#E8A91C"/>
      ${fierce(e, { y: 60, dx: 17, iris: '#FFF3B0', brow: '#7E120C' })}`,
  },
  dragon: {
    body: '#0B4636',
    anchor: { eyeY: 58, dx: 17, top: 28, half: 32 },
    draw: (e) => `
      <path d="M38 38 C26 22 14 12 3 9 C10 24 18 42 30 54 Z M82 38 C94 22 106 12 117 9 C110 24 102 42 90 54 Z" fill="#EFE3CC"/>
      <path d="M3 9 C6 16 10 22 13 27 L22 18 C16 13 9 10 3 9 Z M117 9 C114 16 110 22 107 27 L98 18 C104 13 111 10 117 9 Z" fill="#3A2A26"/>
      <path d="M24 58 L3 50 L12 63 L1 72 L15 75 L11 88 L28 79 Z M96 58 L117 50 L108 63 L119 72 L105 75 L109 88 L92 79 Z" fill="#0F5B46"/>
      <path d="M60 8 L67 30 H53 Z M47 14 L55 32 H43 Z M73 14 L65 32 H77 Z" fill="#0F5B46"/>
      <path d="M60 26 C81 26 95 42 95 60 L87 88 Q78 113 60 115 Q42 113 33 88 L25 60 C25 42 39 26 60 26 Z" fill="#1BA87E"/>
      <path d="M60 26 C81 26 95 42 95 60 L87 88 Q78 113 60 115 Z" fill="#15906B"/>
      <path d="M46 36 l5 5 l5 -5 M64 36 l5 5 l5 -5 M38 46 l4 4 l4 -4 M74 46 l4 4 l4 -4 M55 44 l5 5 l5 -5" fill="none" stroke="#0F6A50" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M41 74 Q60 64 79 74 L77 100 Q60 114 43 100 Z" fill="#35D3A0"/>
      <path d="M49 82 L56 87 L49 90 Z M71 82 L64 87 L71 90 Z" fill="#0B4636" stroke="#0B4636" stroke-width="2" stroke-linejoin="round"/>
      <path d="M46 83 C38 78 36 70 40 64 M74 83 C82 78 84 70 80 64" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/>
      <path d="M43 97 Q60 107 77 97" fill="none" stroke="#0B4636" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M46 99 L50 113 L55 103 Z M74 99 L70 113 L65 103 Z" fill="#FFFDF5"/>
      ${fierce(e, { y: 58, dx: 17, iris: '#FFB627', brow: '#0B4636' })}`,
  },
};

// ── Accessories ────────────────────────────────────────────────

function extra(kind, { eyeY, dx, top: t, half, glassR = 9 }) {
  const l = 60 - dx;
  const r = 60 + dx;
  switch (kind) {
    case 'glasses':
      return `
        <circle cx="${l}" cy="${eyeY}" r="${glassR}" fill="#fff" fill-opacity=".22" stroke="${INK}" stroke-width="2.8"/>
        <circle cx="${r}" cy="${eyeY}" r="${glassR}" fill="#fff" fill-opacity=".22" stroke="${INK}" stroke-width="2.8"/>
        <path d="M${l + glassR} ${eyeY - 1} Q60 ${eyeY - 5} ${r - glassR} ${eyeY - 1}" fill="none" stroke="${INK}" stroke-width="2.8"/>`;
    case 'sunglasses': {
      const w = glassR * 2.3;
      const h = glassR * 1.5;
      const lens = (x) => `<rect x="${x - w / 2}" y="${eyeY - h / 2}" width="${w}" height="${h}" rx="${h / 2.4}" fill="${INK}"/><path d="M${x - w / 4} ${eyeY - h / 5} l${w / 5} ${-h / 6}" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".6"/>`;
      return `${lens(l)}${lens(r)}<path d="M${l + w / 2} ${eyeY - 2} H${r - w / 2}" stroke="${INK}" stroke-width="3"/>`;
    }
    case 'crown':
      return `
        <path d="M43 ${t + 5} V${t - 12} L51.5 ${t - 3} L60 ${t - 16} L68.5 ${t - 3} L77 ${t - 12} V${t + 5} Z" fill="#FFC531" stroke="#D99A00" stroke-width="2.5" stroke-linejoin="round"/>
        <rect x="43" y="${t + 1}" width="34" height="5" rx="1.5" fill="#F2B21B"/>
        <circle cx="60" cy="${t - 3}" r="2.6" fill="#FF5446"/><circle cx="50" cy="${t + 1}" r="1.8" fill="#3CCB8F"/><circle cx="70" cy="${t + 1}" r="1.8" fill="#4A5BF0"/>`;
    case 'party':
      return `
        <path d="M50 ${t + 6} L76 ${t + 2} L68 ${t - 28} Z" fill="url(#stripes)" stroke="#2A3BD1" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="68" cy="${t - 29}" r="5" fill="#FFC531"/>
        <path d="M49 ${t + 6} L77 ${t + 2}" stroke="#FFC531" stroke-width="3.5" stroke-linecap="round"/>`;
    case 'headphones': {
      const x1 = 60 - half - 2;
      const x2 = 60 + half + 2;
      const y = eyeY + 4;
      return `
        <path d="M${x1 + 3} ${y - 6} C${x1} ${t - 14} ${x2} ${t - 14} ${x2 - 3} ${y - 6}" fill="none" stroke="#2D3150" stroke-width="6" stroke-linecap="round"/>
        <rect x="${x1 - 6}" y="${y - 12}" width="13" height="22" rx="6" fill="#FF5A4E"/><rect x="${x2 - 7}" y="${y - 12}" width="13" height="22" rx="6" fill="#FF5A4E"/>
        <rect x="${x1 - 1}" y="${y - 9}" width="5" height="16" rx="2.5" fill="#D93D33"/><rect x="${x2 - 4}" y="${y - 9}" width="5" height="16" rx="2.5" fill="#D93D33"/>`;
    }
    case 'bow':
      return `
        <path d="M76 ${t + 4} L64 ${t - 6} Q62 ${t + 4} 64 ${t + 14} Z M76 ${t + 4} L88 ${t - 6} Q90 ${t + 4} 88 ${t + 14} Z" fill="#FF5A7A" stroke="#E23D60" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="76" cy="${t + 4}" r="4.5" fill="#E23D60"/>`;
    case 'beanie':
      return `
        <path d="M${60 - half + 3} ${t + 14} C${60 - half + 3} ${t - 22} ${60 + half - 3} ${t - 22} ${60 + half - 3} ${t + 14} Z" fill="#3CCB8F"/>
        <path d="M48 ${t - 9} V${t + 10} M60 ${t - 12} V${t + 10} M72 ${t - 9} V${t + 10}" stroke="#2BA874" stroke-width="2.4" stroke-linecap="round"/>
        <rect x="${60 - half}" y="${t + 8}" width="${half * 2}" height="11" rx="5.5" fill="#2BA874"/>
        <circle cx="60" cy="${t - 15}" r="7" fill="#FBFBF7"/>`;
    case 'warpaint': {
      const stripes = (x, s) => `M${x - s * 10} ${eyeY + 9} L${x + s * 8} ${eyeY + 7} L${x + s * 5} ${eyeY + 12} L${x - s * 11} ${eyeY + 14} Z M${x - s * 10} ${eyeY + 17} L${x + s * 5} ${eyeY + 15} L${x + s * 2} ${eyeY + 20} L${x - s * 11} ${eyeY + 22} Z`;
      return `<path d="${stripes(l, 1)} ${stripes(r, -1)}" fill="#E0263C" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>`;
    }
    case 'bandana':
      return `
        <path d="M${60 + half - 2} ${t + 12} L${60 + half + 18} ${t + 4} L${60 + half + 13} ${t + 15} L${60 + half + 20} ${t + 26} L${60 + half} ${t + 20} Z" fill="#B3142B"/>
        <path d="M${60 - half} ${t + 9} Q60 ${t - 7} ${60 + half} ${t + 9} L${60 + half - 1} ${t + 21} Q60 ${t + 6} ${60 - half + 1} ${t + 21} Z" fill="#E0263C"/>
        <circle cx="46" cy="${t + 8}" r="1.8" fill="#fff"/><circle cx="60" cy="${t + 6}" r="1.8" fill="#fff"/><circle cx="74" cy="${t + 8}" r="1.8" fill="#fff"/>`;
    case 'scar':
      return `<path d="M${r - 8} ${eyeY - 19} L${r + 7} ${eyeY + 19}" stroke="#FF6B7A" stroke-width="3.6" stroke-linecap="round"/>
        <path d="M${r - 8.5} ${eyeY - 9} L${r - 0.5} ${eyeY - 12} M${r - 2.5} ${eyeY + 8} L${r + 5.5} ${eyeY + 5}" stroke="#FFD3D8" stroke-width="2.2" stroke-linecap="round"/>`;
    case 'eyepatch':
      return `
        <path d="M${60 - half - 2} ${eyeY - 15} L${r} ${eyeY} L${60 + half + 2} ${eyeY - 4}" fill="none" stroke="#14151F" stroke-width="3.4"/>
        <ellipse cx="${r}" cy="${eyeY + 1}" rx="${glassR + 3.5}" ry="${glassR + 2.5}" fill="#14151F"/>
        <ellipse cx="${r}" cy="${eyeY + 1}" rx="${glassR}" ry="${glassR - 1}" fill="none" stroke="#50556E" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    case 'mohawk':
      return `
        <path d="M42 ${t + 10} L37 ${t - 14} L49 ${t - 3} L51 ${t - 25} L58 ${t - 6} L60 ${t - 31} L62 ${t - 6} L69 ${t - 25} L71 ${t - 3} L83 ${t - 14} L78 ${t + 10} Z" fill="#FF2E88" stroke="#C20F60" stroke-width="2" stroke-linejoin="round"/>
        <path d="M51 ${t + 8} L53 ${t - 10} L57 ${t} L60 ${t - 18} L63 ${t} L67 ${t - 10} L69 ${t + 8} Z" fill="#FF8AC2"/>`;
    case 'collar': {
      const spike = (x, y) => `M${x - 4.5} ${y} L${x} ${y + 12} L${x + 4.5} ${y} Z`;
      return `
        <path d="M22 102 Q60 118 98 102 L102 112 Q60 130 18 112 Z" fill="#20222E"/>
        <path d="${spike(33, 109)} ${spike(46, 114)} ${spike(60, 115)} ${spike(74, 114)} ${spike(87, 109)}" fill="#D5DCE8" stroke="#7C879C" stroke-width="1" stroke-linejoin="round"/>`;
    }
    case 'horns': {
      const x1 = 60 - half;
      const x2 = 60 + half;
      return `
        <path d="M${x1 + 6} ${t + 12} C${x1 - 14} ${t + 2} ${x1 - 12} ${t - 20} ${x1 + 1} ${t - 30} C${x1 + 3} ${t - 15} ${x1 + 13} ${t - 6} ${x1 + 22} ${t + 3} Z M${x2 - 6} ${t + 12} C${x2 + 14} ${t + 2} ${x2 + 12} ${t - 20} ${x2 - 1} ${t - 30} C${x2 - 3} ${t - 15} ${x2 - 13} ${t - 6} ${x2 - 22} ${t + 3} Z" fill="#1B1520" stroke="#FF7A1F" stroke-width="2" stroke-linejoin="round"/>`;
    }
    case 'visor':
      return `
        <rect x="${60 - half - 3}" y="${eyeY - 10}" width="${half * 2 + 6}" height="20" rx="10" fill="#0B1020"/>
        <rect x="${60 - half + 3}" y="${eyeY - 7}" width="${half * 2 - 6}" height="14" rx="7" fill="#39E6FF" opacity=".35"/>
        <rect x="${60 - half + 6}" y="${eyeY - 3}" width="${half * 2 - 12}" height="6" rx="3" fill="#E9FFFF"/>`;
    case 'chain':
      return `
        <path d="M24 92 Q60 128 96 92" fill="none" stroke="#B37700" stroke-width="7" stroke-linecap="round"/>
        <path d="M24 92 Q60 128 96 92" fill="none" stroke="#FFD866" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 6"/>
        <circle cx="60" cy="109" r="8.5" fill="#FFC531" stroke="#B37700" stroke-width="2.4"/>
        <path d="M60 104 L62 108 L66 108.5 L63 111 L64 115 L60 113 L56 115 L57 111 L54 108.5 L58 108 Z" fill="#B37700"/>`;
    case 'flames':
      return `
        <path d="M38 ${t + 10} C31 ${t - 6} 39 ${t - 12} 41 ${t - 22} C47 ${t - 14} 51 ${t - 12} 51 ${t - 28} C58 ${t - 20} 62 ${t - 22} 62 ${t - 35} C70 ${t - 24} 72 ${t - 18} 78 ${t - 24} C80 ${t - 12} 89 ${t - 6} 82 ${t + 10} Z" fill="#FF5A1F"/>
        <path d="M46 ${t + 10} C43 ${t} 49 ${t - 5} 50 ${t - 11} C54 ${t - 6} 57 ${t - 8} 58 ${t - 19} C63 ${t - 11} 66 ${t - 8} 69 ${t - 12} C71 ${t - 5} 77 ${t} 74 ${t + 10} Z" fill="#FFC531"/>`;
    case 'tribal': {
      const swoosh = (x, s) => `M${x - s * 13} ${eyeY - 11} C${x - s * 20} ${eyeY} ${x - s * 16} ${eyeY + 12} ${x - s * 4} ${eyeY + 22} C${x - s * 10} ${eyeY + 11} ${x - s * 11} ${eyeY} ${x - s * 13} ${eyeY - 11} Z M${x - s * 17} ${eyeY + 16} L${x - s * 11} ${eyeY + 15} L${x - s * 11} ${eyeY + 21} Z`;
      return `<path d="${swoosh(l, 1)} ${swoosh(r, -1)}" fill="#14D8BE" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>`;
    }
    case 'goggles': {
      const y = t + 4;
      const lens = (x) => `<circle cx="${x}" cy="${y}" r="11.5" fill="#6B4A2E"/><circle cx="${x}" cy="${y}" r="8" fill="#7CE8FF"/><path d="M${x - 4} ${y - 2} l5 -3" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`;
      return `<path d="M${60 - half - 1} ${y + 5} Q60 ${y - 8} ${60 + half + 1} ${y + 5}" fill="none" stroke="#3A2A1E" stroke-width="7" stroke-linecap="round"/>${lens(46)}${lens(74)}<rect x="55" y="${y - 3}" width="10" height="5" rx="2" fill="#6B4A2E"/>`;
    }
    case 'hood': {
      const faceY = (t + 100) / 2;
      const faceH = (100 - t) / 2 + 2;
      const outer = `M${60 - half - 20} 124 C${60 - half - 26} ${t - 34} 46 ${t - 34} 60 ${t - 26} C74 ${t - 34} ${60 + half + 26} ${t - 34} ${60 + half + 20} 124 Z`;
      const face = `M${60 - half} ${faceY} a${half} ${faceH} 0 1 0 ${half * 2} 0 a${half} ${faceH} 0 1 0 ${-half * 2} 0 Z`;
      return `<path d="${outer} ${face}" fill="#20243A" fill-rule="evenodd"/><path d="${face}" fill="none" stroke="#0D0F1C" stroke-width="3.5"/>`;
    }
    case 'halo':
      return `
        <ellipse cx="60" cy="${t - 11}" rx="28" ry="10" fill="#FFE27A" opacity=".3"/>
        <ellipse cx="60" cy="${t - 11}" rx="25" ry="7.5" fill="none" stroke="#B37700" stroke-width="6.5"/>
        <ellipse cx="60" cy="${t - 11}" rx="25" ry="7.5" fill="none" stroke="#FFE27A" stroke-width="3.6"/>`;
    case 'ascended':
      return `
        <path d="M39 ${t + 7} L34 ${t - 17} L47 ${t - 6} L60 ${t - 24} L73 ${t - 6} L86 ${t - 17} L81 ${t + 7} Z" fill="#FFD866" stroke="#B37700" stroke-width="2.5" stroke-linejoin="round"/>
        <rect x="39" y="${t + 2}" width="42" height="6" rx="2" fill="#F2B21B"/>
        <circle cx="60" cy="${t - 6}" r="9" fill="#FF2E88" opacity=".35"/><circle cx="60" cy="${t - 6}" r="4.6" fill="#FF2E88" stroke="#fff" stroke-width="1.4"/>
        <circle cx="47" cy="${t + 1}" r="2.2" fill="#39E6FF"/><circle cx="73" cy="${t + 1}" r="2.2" fill="#39E6FF"/>`;
    case 'gradcap':
      return `
        <path d="M44 ${t} V${t + 9} Q60 ${t + 16} 76 ${t + 9} V${t} Z" fill="#2D3150"/>
        <path d="M60 ${t - 14} L92 ${t - 3} L60 ${t + 8} L28 ${t - 3} Z" fill="#22243B" stroke="#22243B" stroke-width="2" stroke-linejoin="round"/>
        <path d="M60 ${t - 3} L84 ${t + 2} V${t + 16}" fill="none" stroke="#FFC531" stroke-width="2.4" stroke-linecap="round"/>
        <rect x="81" y="${t + 14}" width="6" height="8" rx="2" fill="#FFC531"/>
        <circle cx="60" cy="${t - 3}" r="2.6" fill="#FFC531"/>`;
    default:
      return '';
  }
}

/** The parts of an extra that sit behind the head, so they show around any skin. */
function extraBehind(kind) {
  const around = (count, turn, shape) => Array.from({ length: count }, (_, i) => `<path d="${shape}" transform="rotate(${(i * 360) / count + turn} 60 60)"/>`).join('');
  switch (kind) {
    case 'katana': {
      const sword = (angle) => `
        <g transform="rotate(${angle} 60 60)">
          <path d="M57 -14 L63 -8 L63 82 L57 82 Z" fill="#DDE5F0" stroke="#7C879C" stroke-width="1.2" stroke-linejoin="round"/>
          <rect x="49" y="82" width="22" height="5" rx="2" fill="#FFC531" stroke="#B37700" stroke-width="1"/>
          <rect x="56" y="87" width="8" height="32" rx="2" fill="#20222E"/>
        </g>`;
      return sword(-40) + sword(40);
    }
    case 'wings': {
      const wing = '<path d="M42 74 C32 46 17 32 4 24 C7 38 6 46 4 56 C9 56 12 58 13 62 C9 64 7 68 7 74 C12 74 15 76 17 80 C14 83 13 86 14 92 C23 90 36 84 42 74 Z" fill="#262A40" stroke="#B9C4DE" stroke-width="2" stroke-linejoin="round"/>';
      return `${wing}<g transform="translate(120 0) scale(-1 1)">${wing}</g>`;
    }
    case 'aura': {
      const spike = (reach, half) => `M${60 - half} 60 L60 ${60 - reach} L${60 + half} 60 Z`;
      return `<g fill="#39E6FF" opacity=".8">${around(18, 0, spike(66, 11))}</g><g fill="#E9FFFF" opacity=".9">${around(18, 10, spike(54, 9))}</g>`;
    }
    case 'ascended': {
      const flame = 'M53 27 C50 16 58 12 60 1 C63 12 70 16 67 27 Z';
      const core = 'M56 27 C55 19 59 16 60 9 C61 16 65 19 64 27 Z';
      return `<circle cx="60" cy="60" r="41" fill="#1B0B3A"/><g fill="#FF2E88">${around(12, 0, flame)}</g><g fill="#FFC531">${around(12, 0, core)}</g>`;
    }
    default:
      return '';
  }
}

// ── Codes ──────────────────────────────────────────────────────

const BG_IDS = Object.keys(BACKGROUNDS);

/** The parts of an avatar code, or null if it isn't a valid code. */
export function parseAvatar(code) {
  const [animal, eye, bg, ex] = String(code || '').split('-');
  if (!ANIMALS.includes(animal) || !EYES.includes(eye) || !BACKGROUNDS[bg] || !EXTRAS.includes(ex)) return null;
  return { animal, eyes: eye, bg, extra: ex };
}

export const avatarCode = ({ animal, eyes: eye, bg, extra: ex }) => `${animal}-${eye}-${bg}-${ex}`;

/**
 * An avatar picked from `seed` (a user id), so every new player starts with their own. Any skin
 * can come up, but only add-ons open at `level`.
 */
export function randomAvatar(seed = String(Math.random()), level = 1, owned = null) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const pick = (part, list) => {
    const open = list.filter((value) => unlockLevel(part, value) <= level && (!owned || unlockPrice(part, value) === 0 || owned.has(itemKey(part, value))));
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    return open[h % open.length];
  };
  return avatarCode({
    animal: pick('animal', ANIMALS),
    eyes: pick('eyes', ['open', ...EYES]),
    bg: pick('bg', BG_IDS.filter((b) => b !== 'cloud')),
    extra: pick('extra', ['none', 'none', 'none', ...EXTRAS.slice(1)]),
  });
}

// What a two-colour background shows behind the player.
const stars = [[20, 28, 1.6], [38, 12, 1.2], [92, 16, 1.8], [104, 40, 1.2], [14, 58, 1.2], [74, 8, 1.1], [108, 66, 1.5]]
  .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity=".85"/>`).join('');
const rays = Array.from({ length: 12 }, (_, i) => `<path d="M60 60 L52 -30 L68 -30 Z" fill="#fff" opacity=".2" transform="rotate(${i * 30} 60 60)"/>`).join('');
const SCENERY = {
  glacier: '<path d="M0 120 L8 78 L18 104 L28 62 L40 120 Z M120 120 L112 74 L102 104 L92 58 L80 120 Z" fill="#E6FAFF" opacity=".75"/><path d="M0 0 L14 0 L8 26 Z M30 0 L44 0 L38 20 Z M78 0 L92 0 L84 24 Z M104 0 L120 0 L114 30 Z" fill="#E6FAFF" opacity=".6"/>',
  aurora: `${stars}<path d="M0 44 C20 20 34 58 60 34 C84 12 98 48 120 26 V70 C98 90 84 54 60 76 C34 98 20 62 0 86 Z" fill="#39FFC2" opacity=".35"/><path d="M0 22 C24 2 40 34 62 14 C86 -6 102 26 120 8 V34 C102 52 86 20 62 40 C40 60 24 28 0 48 Z" fill="#FF4FD8" opacity=".3"/>`,
  storm: '<path d="M22 6 L10 38 L21 36 L13 62 L38 26 L26 29 L34 6 Z M98 12 L89 36 L98 35 L91 54 L110 28 L100 30 L107 12 Z" fill="#D8F4FF" opacity=".8"/>',
  void: stars,
  inferno: '<path d="M0 120 V84 C8 92 14 78 12 62 C24 74 30 66 30 50 C42 62 46 76 44 90 H76 C74 76 78 62 90 50 C90 66 96 74 108 62 C106 78 112 92 120 84 V120 Z" fill="#FFB02E" opacity=".75"/>',
  gold: rays,
};

/** The avatar as a complete SVG document. Invalid codes draw the "hidden player" avatar. */
export function avatarSvg(code) {
  const a = parseAvatar(code);
  if (!a) return HIDDEN_SVG;
  const animal = A[a.animal];
  const bg = BACKGROUNDS[a.bg];
  const glow = Array.isArray(bg);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<defs><clipPath id="c"><circle cx="60" cy="60" r="60"/></clipPath>
${glow ? `<radialGradient id="bg" cx=".5" cy=".42" r=".72"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient>` : ''}
<pattern id="stripes" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="8" height="8" fill="#4A5BF0"/><rect width="4" height="8" fill="#FF7A6B"/></pattern></defs>
<g clip-path="url(#c)">
<rect width="120" height="120" fill="${glow ? 'url(#bg)' : bg}"/>
${glow ? SCENERY[a.bg] ?? '' : '<circle cx="34" cy="26" r="58" fill="#fff" opacity=".13"/>'}
${extraBehind(a.extra)}
<ellipse cx="60" cy="128" rx="40" ry="28" fill="${animal.body}"/>
${animal.draw(a.eyes)}
${extra(a.extra, animal.anchor)}
</g></svg>`;
}

// Shown on public boards for players who hide themselves.
const HIDDEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<circle cx="60" cy="60" r="60" fill="#C9CEE0"/>
<circle cx="60" cy="48" r="20" fill="#9AA1BD"/><ellipse cx="60" cy="112" rx="36" ry="30" fill="#9AA1BD"/>
</svg>`;

export const avatarUrl = (code) => `data:image/svg+xml,${encodeURIComponent(avatarSvg(code))}`;
