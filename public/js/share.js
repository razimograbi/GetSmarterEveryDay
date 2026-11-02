// Sharing results: the copyable emoji line, the phone's share sheet, and a story-sized picture
// (1080×1920) for Instagram, WhatsApp or Telegram stories.

import { avatarUrl } from '/shared/avatars.js';
import { isRtl } from './i18n.js';

/** One square per question: 🟩 right and fast (3 points), 🟨 right, 🟥 wrong, ⬜ not answered. */
export const squareFor = (points) => (points === null ? '⬜' : points >= 3 ? '🟩' : points > 0 ? '🟨' : '🟥');

const SQUARE_COLORS = { '🟩': '#17B877', '🟨': '#FFC531', '🟥': '#FF5446', '⬜': '#C9CEE0' };

/** Copies text. Resolves to true if it worked. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or no permission: copy through a hidden text box.
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.append(box);
    box.select();
    const ok = document.execCommand?.('copy') ?? false;
    box.remove();
    return ok;
  }
}

/**
 * Opens the phone's share sheet with text and a link. Without one (most laptops), copies them
 * instead. Resolves to 'shared', 'copied', 'cancelled' or 'failed'.
 */
export async function shareText({ text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ text, url });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
    }
  }
  return (await copyText(url ? `${text}\n${url}` : text)) ? 'copied' : 'failed';
}

/**
 * Shares a picture through the share sheet (pick Instagram, then Stories) or, where files
 * can't be shared, downloads it. Resolves to 'shared', 'saved' or 'cancelled'.
 */
export async function shareImage(blob, { name = 'smarts.png', text } = {}) {
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return 'saved';
}

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Shrinks the font until `text` fits in `maxWidth`. */
function fitText(ctx, text, maxWidth, size, family, weight = 700) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${family}`;
    s -= 4;
  } while (ctx.measureText(text).width > maxWidth && s > 20);
}

const SHOW = '"Bagel Fat One", "Fredoka", "Baloo Bhaijaan 2", system-ui, sans-serif';
const UI = '"Schibsted Grotesk", "Rubik", "Cairo", system-ui, sans-serif';

/**
 * Draws a result card for stories. `heading` is e.g. "Daily #12"; `squares` the emoji line;
 * `lines` are short lines under the score (rank, "7 of 10 right"); `footer` invites others.
 */
export async function resultImage({ heading, score, max, squares, name, avatar, lines = [], footer, link }) {
  await Promise.all([`400 100px ${SHOW}`, `700 40px ${UI}`, `600 40px ${UI}`].map((f) => document.fonts?.load(f).catch(() => {})));
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.direction = isRtl() ? 'rtl' : 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Background: the app's cobalt, with soft circles.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#3446E0');
  bg.addColorStop(1, '#1B2799');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (const [x, y, r] of [[120, 260, 220], [980, 520, 260], [60, 1650, 300], [1000, 1800, 200]]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#fff';
  ctx.font = `400 120px ${SHOW}`;
  ctx.fillText('Smarts', W / 2, 250);
  ctx.fillStyle = '#FFC531';
  fitText(ctx, heading, 860, 66, UI, 800);
  ctx.fillText(heading, W / 2, 350);

  // The card, sitting on a darker ledge like the cards in the app.
  ctx.fillStyle = '#141C7A';
  roundRect(ctx, 90, 446, 900, 1090, 64);
  ctx.fill();
  ctx.fillStyle = '#FBFBF8';
  roundRect(ctx, 90, 430, 900, 1090, 64);
  ctx.fill();

  const img = await loadImage(avatarUrl(avatar)).catch(() => null);
  if (img) ctx.drawImage(img, W / 2 - 130, 480, 260, 260);
  ctx.fillStyle = '#141833';
  fitText(ctx, name, 780, 60, UI, 800);
  ctx.fillText(name, W / 2, 815);

  ctx.fillStyle = '#2A3BD1';
  ctx.font = `400 250px ${SHOW}`;
  const scoreText = String(score);
  const sw = ctx.measureText(scoreText).width;
  ctx.font = `400 90px ${SHOW}`;
  const mw = ctx.measureText(`/${max}`).width;
  const left = W / 2 - (sw + mw) / 2;
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.font = `400 250px ${SHOW}`;
  ctx.fillText(scoreText, left, 1070);
  ctx.fillStyle = '#8A90B5';
  ctx.font = `400 90px ${SHOW}`;
  ctx.fillText(`/${max}`, left + sw + 6, 1070);
  ctx.textAlign = 'center';
  ctx.direction = isRtl() ? 'rtl' : 'ltr';

  // The squares, always left to right like the questions were played.
  const size = 70;
  const gap = 12;
  const total = squares.length * size + (squares.length - 1) * gap;
  squares.forEach((sq, i) => {
    ctx.fillStyle = SQUARE_COLORS[sq] || SQUARE_COLORS['⬜'];
    roundRect(ctx, W / 2 - total / 2 + i * (size + gap), 1130, size, size, 16);
    ctx.fill();
  });

  ctx.fillStyle = '#555B7A';
  lines.forEach((line, i) => {
    fitText(ctx, line, 800, 46, UI, 600);
    ctx.fillText(line, W / 2, 1300 + i * 70);
  });

  ctx.fillStyle = '#fff';
  fitText(ctx, footer, 920, 64, UI, 800);
  ctx.fillText(footer, W / 2, 1690);
  ctx.fillStyle = '#FFC531';
  ctx.direction = 'ltr';
  fitText(ctx, link, 920, 46, UI, 700);
  ctx.fillText(link, W / 2, 1780);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
