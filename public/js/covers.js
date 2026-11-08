// The covers around players' avatars. Each level tier (LEVEL_TIERS in shared/config.js) has a ring
// in its own metal, ornaments that grow with the tier, and a plaque the level number sits on.
//
// A cover is drawn on a 150×150 canvas with the avatar as a circle of radius 50 in the middle. The
// number is ordinary text on top (see .cover-num in app.css), so it uses the app's own font.

const METALS = {
  rookie: ['#DCE3F0', '#8F9BB6', '#4D5875'],
  bronze: ['#F6C08C', '#C2773A', '#6E3D18'],
  silver: ['#FFFFFF', '#C2CCDC', '#68758E'],
  gold: ['#FFF3B0', '#FFC531', '#A86A00'],
  platinum: ['#EFFFFB', '#82E8D8', '#167C78'],
  diamond: ['#EAF8FF', '#6FC3FF', '#4A37DB'],
  legend: ['#FFE98F', '#FF7A1F', '#860D1C'],
};

const mirrored = (paths) => `${paths}<g transform="translate(150 0) scale(-1 1)">${paths}</g>`;

const around = (count, path) =>
  Array.from({ length: count }, (_, i) => `<g transform="rotate(${(i * 360) / count} 75 75)">${path}</g>`).join('');

const edged = (d, dark) => `<path d="${d}" fill="url(#m)" stroke="${dark}" stroke-width="2.5" stroke-linejoin="round"/>`;

const STAR = 'M75 2 L79 11.5 L89 12.5 L81.5 19 L83.7 29 L75 23.8 L66.3 29 L68.5 19 L61 12.5 L71 11.5 Z';
const SMALL_WING = 'M26 58 Q12 54 5 42 Q6 62 23 72 Z M23 74 Q9 75 1 66 Q5 84 25 87 Z M27 89 Q15 94 7 88 Q14 103 34 100 Z';
const LARGE_WING = `M33 45 Q19 36 17 20 Q9 44 26 60 Z ${SMALL_WING}`;

const ORNAMENTS = {
  rookie: () => '',
  bronze: (dark) => mirrored(edged('M21 66 L9 75 L21 84 Z', dark)),
  silver: (dark) => mirrored(edged(SMALL_WING, dark)),
  gold: (dark) => mirrored(edged(LARGE_WING, dark)) + edged(STAR, dark),
  platinum: (dark) => around(8, edged('M67 22 L75 3 L83 22 Z', dark)) + edged(STAR, dark),
  diamond: (dark) => around(12, edged('M69 22 L75 0 L81 22 Z', dark)) + around(12, `<g transform="rotate(15 75 75)">${edged('M71 22 L75 8 L79 22 Z', dark)}</g>`),
  legend: (dark) => around(12, `<path d="M64 26 C60 14 71 11 72 0 C81 8 90 14 86 26 Z" fill="url(#m)" stroke="${dark}" stroke-width="2.5" stroke-linejoin="round"/>`) + edged(STAR, dark),
};

const PLAQUES = {
  rookie: 'M-17 -14 H17 A14 14 0 0 1 17 14 H-17 A14 14 0 0 1 -17 -14 Z',
  bronze: 'M-24 -14 H24 L32 0 L24 14 H-24 L-32 0 Z',
  silver: 'M-25 -15 H25 L32 -5 V5 L18 16 H-18 L-32 5 V-5 Z',
  gold: 'M-32 -9 L-21 -17 L-11 -11 L0 -19 L11 -11 L21 -17 L32 -9 V7 L18 18 H-18 L-32 7 Z',
  platinum: 'M-20 -16 H20 L34 -6 V6 L20 16 H-20 L-34 6 V-6 Z',
  diamond: 'M-20 -17 H20 L36 0 L20 17 H-20 L-36 0 Z',
  legend: 'M-33 -10 L-24 -20 L-15 -12 L0 -23 L15 -12 L24 -20 L33 -10 V6 L19 19 H-19 L-33 6 Z',
};

function coverSvg(tier) {
  const [light, middle, dark] = METALS[tier];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 150">
<defs><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset=".55" stop-color="${middle}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
${ORNAMENTS[tier](dark)}
<circle cx="75" cy="75" r="53" fill="none" stroke="${dark}" stroke-width="9"/>
<circle cx="75" cy="75" r="53" fill="none" stroke="url(#m)" stroke-width="5.5"/>
<g transform="translate(75 127)">${edged(PLAQUES[tier], dark)}</g>
</svg>`;
}

const urls = new Map();

/** The picture of a tier's cover, as an address for an <img>. */
export function coverUrl(tier) {
  if (!urls.has(tier)) urls.set(tier, `data:image/svg+xml,${encodeURIComponent(coverSvg(tier))}`);
  return urls.get(tier);
}
