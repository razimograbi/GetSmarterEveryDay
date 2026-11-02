// Player avatars: an illustrated animal with a face, a background colour and an accessory,
// drawn as SVG. Shared by the browser (to draw them) and the server (to check a chosen avatar).
//
// An avatar is stored as a code: "animal-eyes-background-extra", for example
// "fox-happy-marigold-crown". avatarSvg(code) draws it; avatarUrl(code) gives an image address.

export const ANIMALS = ['cat', 'fox', 'bear', 'panda', 'koala', 'rabbit', 'owl', 'penguin', 'frog', 'lion', 'dog', 'monkey'];
export const EYES = ['open', 'happy', 'wink'];
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
};
export const EXTRAS = ['none', 'glasses', 'sunglasses', 'crown', 'party', 'headphones', 'bow', 'beanie', 'gradcap'];

const INK = '#22243B';
const BLUSH = '#FF8FA3';

// ── Faces ──────────────────────────────────────────────────────

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
  const [l, rt] = [cx - dx, cx + dx];
  if (style === 'happy') return shut(l) + shut(rt);
  if (style === 'wink') return open(l) + shut(rt);
  return open(l) + open(rt);
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

// ── Codes ──────────────────────────────────────────────────────

const BG_IDS = Object.keys(BACKGROUNDS);

/** The parts of an avatar code, or null if it isn't a valid code. */
export function parseAvatar(code) {
  const [animal, eye, bg, ex] = String(code || '').split('-');
  if (!ANIMALS.includes(animal) || !EYES.includes(eye) || !BACKGROUNDS[bg] || !EXTRAS.includes(ex)) return null;
  return { animal, eyes: eye, bg, extra: ex };
}

export const avatarCode = ({ animal, eyes: eye, bg, extra: ex }) => `${animal}-${eye}-${bg}-${ex}`;

/** A pleasant avatar picked from `seed` (a user id), so every new player starts with their own. */
export function randomAvatar(seed = String(Math.random())) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const pick = (list) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    return list[h % list.length];
  };
  return avatarCode({
    animal: pick(ANIMALS),
    eyes: pick(['open', 'open', 'happy', 'wink']),
    bg: pick(BG_IDS.filter((b) => b !== 'cloud')),
    extra: pick(['none', 'none', 'none', ...EXTRAS.slice(1)]),
  });
}

/** The avatar as a complete SVG document. Invalid codes draw the "hidden player" avatar. */
export function avatarSvg(code) {
  const a = parseAvatar(code);
  if (!a) return HIDDEN_SVG;
  const animal = A[a.animal];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<defs><clipPath id="c"><circle cx="60" cy="60" r="60"/></clipPath>
<pattern id="stripes" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="8" height="8" fill="#4A5BF0"/><rect width="4" height="8" fill="#FF7A6B"/></pattern></defs>
<g clip-path="url(#c)">
<rect width="120" height="120" fill="${BACKGROUNDS[a.bg]}"/>
<circle cx="34" cy="26" r="58" fill="#fff" opacity=".13"/>
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
