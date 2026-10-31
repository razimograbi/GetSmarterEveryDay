// European (Vienna Convention style) road signs, drawn in SVG on a 200×200 grid.

const RED = '#C1121F';
const BLUE = '#0B4EA2';
const YELLOW = '#F7C600';
const BLACK = '#1A1A1A';
const WHITE = '#FFFFFF';

const svg = (inner, label) =>
  `<svg viewBox="0 0 200 200" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

const edge = `<circle cx="100" cy="100" r="98" fill="${WHITE}"/>`;
const ring = (fill = WHITE) => `${edge}<circle cx="100" cy="100" r="84" fill="${fill}" stroke="${RED}" stroke-width="22"/>`;
const blueDisc = `${edge}<circle cx="100" cy="100" r="94" fill="${BLUE}"/>`;
const slash = (dir = '\\', color = RED, w = 18) =>
  dir === '\\'
    ? `<line x1="42" y1="42" x2="158" y2="158" stroke="${color}" stroke-width="${w}"/>`
    : `<line x1="158" y1="42" x2="42" y2="158" stroke="${color}" stroke-width="${w}"/>`;
const warning = (inner) =>
  `<polygon points="100,16 190,172 10,172" fill="${WHITE}" stroke="${RED}" stroke-width="15" stroke-linejoin="round"/>${inner}`;
const text = (t, { size = 84, fill = BLACK, y = 130 } = {}) =>
  `<text x="100" y="${y}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}" fill="${fill}" letter-spacing="-2">${t}</text>`;

function octagon(r) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 8) * (2 * i + 1);
    pts.push(`${(100 + r * Math.cos(a)).toFixed(1)},${(100 + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function stripes(clipId, clipShape, dir) {
  // Thin parallel lines across the sign, the "end of restriction" pattern.
  const lines = [-18, -9, 0, 9, 18]
    .map((d) => {
      const o = d / Math.SQRT2;
      return dir === '/'
        ? `<line x1="${170 + o}" y1="${30 + o}" x2="${30 + o}" y2="${170 + o}" stroke="${BLACK}" stroke-width="3.2"/>`
        : `<line x1="${30 - o}" y1="${30 + o}" x2="${170 - o}" y2="${170 + o}" stroke="${BLACK}" stroke-width="3.2"/>`;
    })
    .join('');
  return `<defs><clipPath id="${clipId}">${clipShape}</clipPath></defs><g clip-path="url(#${clipId})">${lines}</g>`;
}

function roundaboutArrows() {
  // Three white arrows chasing each other anticlockwise.
  const r = 48;
  let out = '';
  for (let k = 0; k < 3; k++) {
    const start = (k * 120 + 20) * (Math.PI / 180);
    const end = start - 78 * (Math.PI / 180); // anticlockwise in screen space
    const p = (a, rr = r) => [100 + rr * Math.cos(a), 100 + rr * Math.sin(a)];
    const [x1, y1] = p(start);
    const [x2, y2] = p(end);
    out += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 0 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${WHITE}" stroke-width="15"/>`;
    // Arrowhead: tangent direction at `end` going anticlockwise.
    const tip = end - 0.32;
    const [tx, ty] = p(tip);
    const [ax, ay] = p(end, r + 17);
    const [bx, by] = p(end, r - 17);
    out += `<polygon points="${tx.toFixed(1)},${ty.toFixed(1)} ${ax.toFixed(1)},${ay.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}" fill="${WHITE}"/>`;
  }
  return out;
}

const DIAMOND_OUTER = '100,5 195,100 100,195 5,100';
const DIAMOND_INNER = '100,34 166,100 100,166 34,100';

const SIGNS = {
  stop: () =>
    `<polygon points="${octagon(97)}" fill="${WHITE}"/>` +
    `<polygon points="${octagon(92)}" fill="${RED}"/>` +
    `<polygon points="${octagon(83)}" fill="none" stroke="${WHITE}" stroke-width="4"/>` +
    text('STOP', { size: 47, fill: WHITE, y: 119 }),

  'give-way': () =>
    `<polygon points="12,32 188,32 100,184" fill="${WHITE}" stroke="${RED}" stroke-width="17" stroke-linejoin="round"/>`,

  'no-entry': () =>
    `${edge}<circle cx="100" cy="100" r="94" fill="${RED}"/><rect x="32" y="84" width="136" height="32" fill="${WHITE}"/>`,

  'no-vehicles': () => ring(),

  'no-parking': () => ring(BLUE) + slash('\\'),

  'no-stopping': () => ring(BLUE) + slash('\\') + slash('/'),

  'no-u-turn': () =>
    ring() +
    `<path d="M124 152 V90 A24 24 0 0 0 76 90 V116" fill="none" stroke="${BLACK}" stroke-width="15"/>` +
    `<polygon points="56,112 96,112 76,146" fill="${BLACK}"/>` +
    slash('\\', RED, 15),

  'no-left-turn': () =>
    ring() +
    `<path d="M120 158 V102 Q120 80 98 80 H76" fill="none" stroke="${BLACK}" stroke-width="15"/>` +
    `<polygon points="80,58 80,102 46,80" fill="${BLACK}"/>` +
    slash('\\', RED, 15),

  'speed-50': () => ring() + text('50'),

  'end-speed': () =>
    `${edge}<circle cx="100" cy="100" r="92" fill="${WHITE}" stroke="${BLACK}" stroke-width="3"/>` +
    text('50', { fill: '#9A9A9A' }) +
    stripes('end-speed-clip', '<circle cx="100" cy="100" r="88"/>', '/'),

  'min-speed': () => blueDisc + text('30', { fill: WHITE }),

  roundabout: () => blueDisc + roundaboutArrows(),

  'keep-right': () =>
    blueDisc +
    `<g transform="rotate(45 100 100)"><rect x="46" y="91" width="74" height="18" fill="${WHITE}"/><polygon points="112,64 152,100 112,136" fill="${WHITE}"/></g>`,

  'one-way': () =>
    `<rect x="6" y="52" width="188" height="96" rx="10" fill="${WHITE}"/>` +
    `<rect x="11" y="57" width="178" height="86" rx="7" fill="${BLUE}"/>` +
    `<rect x="34" y="91" width="96" height="18" fill="${WHITE}"/><polygon points="124,70 166,100 124,130" fill="${WHITE}"/>`,

  'dead-end': () =>
    `<rect x="8" y="8" width="184" height="184" rx="16" fill="${WHITE}"/>` +
    `<rect x="14" y="14" width="172" height="172" rx="12" fill="${BLUE}"/>` +
    `<rect x="88" y="72" width="24" height="98" fill="${WHITE}"/><rect x="54" y="42" width="92" height="30" fill="${RED}"/>`,

  priority: () =>
    `<polygon points="${DIAMOND_OUTER}" fill="${WHITE}" stroke="#2B2B2B" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<polygon points="${DIAMOND_INNER}" fill="${YELLOW}"/>`,

  'end-priority': () =>
    `<polygon points="${DIAMOND_OUTER}" fill="${WHITE}" stroke="#2B2B2B" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<polygon points="${DIAMOND_INNER}" fill="${YELLOW}"/>` +
    stripes('end-priority-clip', `<polygon points="${DIAMOND_OUTER}"/>`, '/'),

  signals: () =>
    warning(
      `<rect x="84" y="64" width="32" height="96" rx="9" fill="${BLACK}"/>` +
        `<circle cx="100" cy="81" r="11" fill="#E0242F"/><circle cx="100" cy="112" r="11" fill="#F5B400"/><circle cx="100" cy="143" r="11" fill="#1FA34A"/>`
    ),

  'two-way': () =>
    warning(
      `<rect x="77" y="78" width="11" height="56" fill="${BLACK}"/><polygon points="68,130 97,130 82.5,158" fill="${BLACK}"/>` +
        `<rect x="112" y="92" width="11" height="64" fill="${BLACK}"/><polygon points="103,96 132,96 117.5,66" fill="${BLACK}"/>`
    ),

  crossroads: () =>
    warning(`<rect x="92" y="60" width="16" height="100" fill="${BLACK}"/><rect x="56" y="104" width="88" height="16" fill="${BLACK}"/>`),
};

export function signSvg(id, label = 'Road sign') {
  const draw = SIGNS[id];
  return draw ? svg(draw(), label) : svg(`<circle cx="100" cy="100" r="90" fill="#ddd"/>`, label);
}

export const SIGN_IDS = Object.keys(SIGNS);
