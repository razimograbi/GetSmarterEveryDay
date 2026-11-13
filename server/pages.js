// The standalone pages: privacy policy, terms of use and photo credits, each in English,
// Hebrew and Arabic. They work without JavaScript or signing in, so Google's sign-in screen,
// ad networks and app stores can link to them.
//
// /privacy, /terms and /credits pick the language from ?lang=xx, else the browser's
// languages, else English. The text of the privacy policy and terms is in legal/<page>.<lang>.html;
// the credits page is drawn from legal/credits.json (made by `npm run fetch-credits`).

import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CATEGORIES, CATEGORY_BY_ID, localDate, dailyNumber } from '../shared/config.js';
import { getDuel, getProfile, getSettings, profileByCode } from './db.js';
import { cats as HE_CATS } from '../public/lang/he/ui.js';
import { cats as AR_CATS } from '../public/lang/ar/ui.js';

const LEGAL = join(resolve(import.meta.dirname, '..'), 'legal');

const LANGS = {
  en: { name: 'English', dir: 'ltr' },
  he: { name: 'עברית', dir: 'rtl' },
  ar: { name: 'العربية', dir: 'rtl' },
};

const TEXT = {
  en: {
    privacy: 'Privacy policy',
    terms: 'Terms of use',
    credits: 'Photo credits',
    back: 'Back to the quiz',
    langs: 'Language',
    pages: 'Other pages',
    creditsIntro: 'Many pictures in Smarts come from Wikimedia Commons and Wikipedia, shared by their authors under free licences. Each one is listed below with its author and licence. Open a file name to see its page, with the full licence and details. In the game, pictures are resized or cropped, and some have parts blurred so they don\'t give the answer away.',
    checked: 'Last checked {date} · {n} pictures',
    unknownAuthor: 'Author not stated',
    noLicense: 'Licence: see the file page',
    by: 'by',
    otherTitle: 'Other pictures and data',
    screensTitle: 'Home screen',
    other: [
      'Flags: <a href="https://flagcdn.com">flagcdn.com</a>. National flags are in the public domain.',
      'Country outlines: drawn from <a href="https://www.naturalearthdata.com">Natural Earth</a> map data (public domain), via <a href="https://github.com/topojson/world-atlas">world-atlas</a> (ISC licence).',
      'Satellite maps: Esri World Imagery. Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community.',
      'European road signs and periodic table tiles: drawn for Smarts.',
      'Fonts: <a href="https://fonts.google.com">Google Fonts</a>, under the SIL Open Font License.',
    ],
    marksTitle: 'Logos, crests and banknotes',
    marks: 'Company logos, club crests and banknotes belong to their owners and are shown only so players can recognise them. Smarts isn\'t connected to or endorsed by any of them. Files marked "Fair use" are not freely licensed.',
    contact: 'Is your picture here without the right credit? Write to <a href="mailto:razimograbi44@gmail.com">razimograbi44@gmail.com</a> and it will be fixed or removed.',
  },
  he: {
    privacy: 'מדיניות פרטיות',
    terms: 'תנאי שימוש',
    credits: 'קרדיט לתמונות',
    back: 'חזרה לחידון',
    langs: 'שפה',
    pages: 'דפים נוספים',
    creditsIntro: 'תמונות רבות ב-Smarts מגיעות מוויקישיתוף ומוויקיפדיה, ויוצריהן שיתפו אותן ברישיונות חופשיים. כל תמונה מופיעה כאן עם היוצר והרישיון שלה. לחיצה על שם קובץ פותחת את הדף שלו, עם הרישיון המלא והפרטים. במשחק התמונות מוקטנות או חתוכות, ובחלקן יש אזורים מטושטשים כדי שלא יסגירו את התשובה.',
    checked: 'נבדק לאחרונה {date} · {n} תמונות',
    unknownAuthor: 'היוצר לא צוין',
    noLicense: 'רישיון: ראו בדף הקובץ',
    by: 'מאת',
    otherTitle: 'תמונות ונתונים נוספים',
    screensTitle: 'מסך הבית',
    other: [
      'דגלים: <a href="https://flagcdn.com">flagcdn.com</a>. דגלי מדינות הם נחלת הכלל.',
      'קווי מתאר של מדינות: מנתוני המפות של <a href="https://www.naturalearthdata.com">Natural Earth</a> (נחלת הכלל), דרך <a href="https://github.com/topojson/world-atlas">world-atlas</a> (רישיון ISC).',
      'מפות לוויין: Esri World Imagery. מקור: Esri, Maxar, Earthstar Geographics, and the GIS User Community.',
      'תמרורים אירופיים ומשבצות הטבלה המחזורית: צוירו עבור Smarts.',
      'גופנים: <a href="https://fonts.google.com">Google Fonts</a>, ברישיון SIL Open Font License.',
    ],
    marksTitle: 'סמלים, סמלי מועדונים ושטרות',
    marks: 'סמלי חברות, סמלי מועדונים ושטרות שייכים לבעליהם, ומוצגים רק כדי שהשחקנים יזהו אותם. Smarts אינו קשור לאף אחד מהם ואינו מקבל מהם חסות. קבצים שמסומנים "Fair use" אינם ברישיון חופשי.',
    contact: 'התמונה שלך מופיעה כאן בלי קרדיט נכון? כתבו ל-<a href="mailto:razimograbi44@gmail.com">razimograbi44@gmail.com</a> והיא תתוקן או תוסר.',
  },
  ar: {
    privacy: 'سياسة الخصوصية',
    terms: 'شروط الاستخدام',
    credits: 'حقوق الصور',
    back: 'العودة إلى المسابقة',
    langs: 'اللغة',
    pages: 'صفحات أخرى',
    creditsIntro: 'كثير من الصور في Smarts مصدرها ويكيميديا كومنز وويكيبيديا، وقد شاركها أصحابها برخص حرة. تجد هنا كل صورة مع اسم صاحبها ورخصتها. افتح اسم الملف لترى صفحته مع الرخصة الكاملة والتفاصيل. في اللعبة تُصغَّر الصور أو تُقص، وبعضها فيه أجزاء مموّهة كي لا تكشف الإجابة.',
    checked: 'آخر فحص {date} · {n} صورة',
    unknownAuthor: 'لم يُذكر صاحب الصورة',
    noLicense: 'الرخصة: انظر صفحة الملف',
    by: 'بواسطة',
    otherTitle: 'صور وبيانات أخرى',
    screensTitle: 'الشاشة الرئيسية',
    other: [
      'الأعلام: <a href="https://flagcdn.com">flagcdn.com</a>. أعلام الدول ملك عام.',
      'حدود الدول: مرسومة من بيانات خرائط <a href="https://www.naturalearthdata.com">Natural Earth</a> (ملك عام)، عبر <a href="https://github.com/topojson/world-atlas">world-atlas</a> (رخصة ISC).',
      'صور الأقمار الصناعية: Esri World Imagery. المصدر: Esri, Maxar, Earthstar Geographics, and the GIS User Community.',
      'إشارات المرور الأوروبية وخانات الجدول الدوري: رُسمت خصيصًا لـ Smarts.',
      'الخطوط: <a href="https://fonts.google.com">Google Fonts</a>، برخصة SIL Open Font License.',
    ],
    marksTitle: 'الشعارات وشعارات الأندية والأوراق النقدية',
    marks: 'شعارات الشركات وشعارات الأندية والأوراق النقدية ملك لأصحابها، وتُعرض فقط ليتعرّف عليها اللاعبون. Smarts لا يرتبط بأي منها ولا يحظى برعايتها. الملفات المعلَّمة بـ "Fair use" ليست برخصة حرة.',
    contact: 'هل صورتك هنا دون ذكر صحيح لحقوقها؟ اكتب إلى <a href="mailto:razimograbi44@gmail.com">razimograbi44@gmail.com</a> وسنصححها أو نزيلها.',
  },
};

const CAT_NAMES = { he: HE_CATS, ar: AR_CATS };
const catName = (lang, id) => CAT_NAMES[lang]?.[id]?.name ?? CATEGORY_BY_ID[id]?.name ?? id;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/** ?lang=xx, else the first supported language the browser asks for, else English. */
function pickLang(req) {
  const asked = new URL(req.url, 'http://localhost').searchParams.get('lang');
  if (LANGS[asked]) return asked;
  const prefs = String(req.headers['accept-language'] || '')
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { base: tag.toLowerCase().split('-')[0].replace(/^iw$/, 'he'), q: q === undefined ? 1 : Number(q) || 0 };
    })
    .sort((a, b) => b.q - a.q);
  return prefs.find((p) => LANGS[p.base])?.base || 'en';
}

function layout(lang, page, body) {
  const T = TEXT[lang];
  const langLinks = Object.entries(LANGS).map(([id, l]) =>
    `<a href="/${page}?lang=${id}" lang="${id}" hreflang="${id}"${id === lang ? ' aria-current="true"' : ''}>${esc(l.name)}</a>`).join('');
  const pageLinks = ['privacy', 'terms', 'credits'].filter((p) => p !== page)
    .map((p) => `<a href="/${p}?lang=${lang}">${esc(T[p])}</a>`).join('');
  return `<!doctype html>
<html lang="${lang}" dir="${LANGS[lang].dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#2A3BD1">
  <title>${esc(T[page])} · Smarts</title>
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/legal.css">
  ${Object.keys(LANGS).map((id) => `<link rel="alternate" hreflang="${id}" href="/${page}?lang=${id}">`).join('\n  ')}
</head>
<body>
<main>
  <nav class="langs" aria-label="${esc(T.langs)}">${langLinks}</nav>
  ${body}
  <nav class="more" aria-label="${esc(T.pages)}">${pageLinks}</nav>
  <a class="back" href="/">${esc(T.back)}</a>
</main>
</body>
</html>`;
}

// Rendered pages are kept until their source file changes.
const cache = new Map(); // "page:lang" -> { mtime, html }

async function render(page, lang) {
  const file = page === 'credits' ? join(LEGAL, 'credits.json') : join(LEGAL, `${page}.${lang}.html`);
  const { mtimeMs } = await stat(file);
  const key = `${page}:${lang}`;
  const hit = cache.get(key);
  if (hit?.mtime === mtimeMs) return hit.html;
  const source = await readFile(file, 'utf8');
  const html = layout(lang, page, page === 'credits' ? creditsBody(lang, JSON.parse(source)) : source);
  cache.set(key, { mtime: mtimeMs, html });
  return html;
}

function creditsBody(lang, { generated, files }) {
  const T = TEXT[lang];
  const byTopic = new Map(CATEGORIES.map((c) => [c.id, []]));
  const screens = []; // photos that aren't a topic's, such as the Daily's on the home screen
  for (const f of files) (byTopic.get(f.topics[0]) ?? screens).push(f);
  const item = (f) => {
    const license = f.license
      ? (f.licenseUrl ? `<a href="${esc(f.licenseUrl)}">${esc(f.license)}</a>` : esc(f.license))
      : esc(T.noLicense);
    return `<li><a href="${esc(f.page)}" dir="ltr">${esc(f.file)}</a><span>${f.author ? `${esc(T.by)} <bdi>${esc(f.author)}</bdi>` : esc(T.unknownAuthor)} · <span dir="ltr">${license}</span></span></li>`;
  };
  const sections = [...byTopic].filter(([, list]) => list.length).map(([id, list]) => `
  <h2>${esc(catName(lang, id))}</h2>
  <ul class="credits">${list.map(item).join('')}</ul>`).join('') + (screens.length ? `
  <h2>${esc(T.screensTitle)}</h2>
  <ul class="credits">${screens.map(item).join('')}</ul>` : '');
  return `
  <h1>${esc(T.credits)}</h1>
  <p class="updated">${esc(fill(T.checked, { date: generated, n: files.length }))}</p>
  <p>${esc(T.creditsIntro)}</p>
  <h2>${esc(T.otherTitle)}</h2>
  <ul>${T.other.map((o) => `<li>${o}</li>`).join('')}</ul>
  <h2>${esc(T.marksTitle)}</h2>
  <p>${esc(T.marks)}</p>
  <p>${T.contact}</p>
  ${sections}`;
}

// ── Link previews ──────────────────────────────────────────────
// The title and description WhatsApp, Telegram and others show for a shared link.

const SHARE = {
  en: {
    title: 'Smarts, the picture quiz',
    description: 'Flags, landmarks, logos, paintings and more. Play the Daily, duel your friends and keep your streak going.',
    dailyTitle: 'Smarts Daily #{n}',
    dailyDescription: 'Ten picture questions, the same for everyone today. One try. Can you beat my score?',
    duelTitle: '{name} challenged you to a duel',
    duelScored: '{name} scored {score} out of 30. Same 10 questions: can you beat it?',
    duelOpen: 'Same 10 questions for both of you. Who knows more?',
    inviteTitle: '{name} invited you to Smarts',
    inviteDescription: 'Add each other as friends, then play the Daily and duel.',
  },
  he: {
    title: 'Smarts, חידון התמונות',
    description: 'דגלים, אתרים מפורסמים, לוגואים, ציורים ועוד. שחקו באתגר היומי, התמודדו מול חברים ושמרו על הרצף.',
    dailyTitle: 'האתגר היומי של Smarts #{n}',
    dailyDescription: 'עשר שאלות בתמונות, אותן שאלות לכולם היום. ניסיון אחד. תצליחו לעקוף אותי?',
    duelTitle: '{name} הזמין/ה אותך לדו־קרב',
    duelScored: '{name} השיג/ה {score} מתוך 30. אותן עשר שאלות: תצליחו לנצח?',
    duelOpen: 'אותן עשר שאלות לשניכם. מי יודע יותר?',
    inviteTitle: '{name} הזמין/ה אותך ל-Smarts',
    inviteDescription: 'הוסיפו זה את זה כחברים, ואז שחקו באתגר היומי ובדו־קרבות.',
  },
  ar: {
    title: 'Smarts، مسابقة الصور',
    description: 'أعلام ومعالم وشعارات ولوحات والمزيد. العب تحدّي اليوم، وبارز أصدقاءك، وحافظ على سلسلتك.',
    dailyTitle: 'تحدّي Smarts اليومي #{n}',
    dailyDescription: 'عشرة أسئلة بالصور، نفسها للجميع اليوم. محاولة واحدة. هل تتفوّق على نتيجتي؟',
    duelTitle: '{name} يتحدّاك في مبارزة',
    duelScored: 'حصل {name} على {score} من 30. الأسئلة العشرة نفسها: هل تتفوّق عليه؟',
    duelOpen: 'الأسئلة العشرة نفسها لكليكما. من يعرف أكثر؟',
    inviteTitle: '{name} يدعوك إلى Smarts',
    inviteDescription: 'أضيفا بعضكما كأصدقاء، ثم العبا تحدّي اليوم والمبارزات.',
  },
};

/**
 * The link preview for an address in the app: a duel, a friend invite, the Daily, or the app
 * itself. In the language of `?l=` in the link, else the sender's language, else the browser's.
 */
export function shareMeta(db, pathname, linkLang, acceptLanguage) {
  const pick = (...langs) => langs.find((l) => SHARE[l]) || 'en';
  const browser = pickLang({ url: '/', headers: { 'accept-language': acceptLanguage } });
  const duelId = /^\/duel\/([A-Z2-9]{8})\/?$/.exec(pathname)?.[1];
  const inviteCode = /^\/f\/([A-Za-z2-9]{6})\/?$/.exec(pathname)?.[1];
  if (duelId) {
    const duel = getDuel(db, duelId);
    const who = duel && getProfile(db, duel.challengerId);
    if (who) {
      const T = SHARE[pick(linkLang, getSettings(db, who.id)?.language, browser)];
      const vars = { name: who.name, score: duel.challenger.score };
      return { title: fill(T.duelTitle, vars), description: fill(duel.challenger.score === null ? T.duelOpen : T.duelScored, vars) };
    }
  }
  if (inviteCode) {
    const who = profileByCode(db, inviteCode);
    if (who) {
      const T = SHARE[pick(linkLang, getSettings(db, who.id)?.language, browser)];
      return { title: fill(T.inviteTitle, { name: who.name }), description: T.inviteDescription };
    }
  }
  const T = SHARE[pick(linkLang, browser)];
  if (/^\/daily\/?$/.test(pathname)) return { title: fill(T.dailyTitle, { n: dailyNumber(localDate(0)) }), description: T.dailyDescription };
  return { title: T.title, description: T.description };
}

/** The page for `pathname` ({ html, headers }), or null if it isn't one of these pages. */
export async function legalPage(req, pathname) {
  const page = /^\/(privacy|terms|credits)\/?$/.exec(pathname)?.[1];
  if (!page) return null;
  const lang = pickLang(req);
  return {
    html: await render(page, lang),
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Language': lang,
      'Cache-Control': 'no-cache',
      Vary: 'Accept-Language',
    },
  };
}
