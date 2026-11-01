import { QUESTIONS, QUESTION_BY_ID } from '/shared/questions.js';
import {
  MODES, DEFAULT_MODE, CATEGORIES, CATEGORY_BY_ID, AUTO_DELAY, REPORT_REASONS, REPORT_NOTE_MAX, pointsFor, secondsFor,
} from '/shared/config.js';
import { render as renderVisual, preload, isPreloaded, fetchNow, missingHtml, loadLocalImages } from './visuals.js';
import { signSvg } from './signs.js';
import { ICONS } from './icons.js';
import { api, esc, shuffle, reduceMotion } from './util.js';
import {
  LANGUAGES, lang, setLang, savedLang, rememberLang, deviceLang, isLang, t, tn, qt, catName, catBlurb, reasonLabel, timeAgo, fmtDate,
} from './i18n.js';

const app = document.getElementById('app');
const state = { config: null, user: null, settings: null, stats: null, lastRound: null };
let cleanup = () => {};
let navId = 0; // bumps on every screen change; async screens check it before drawing

const CAT_COUNT = Object.fromEntries(CATEGORIES.map((c) => [c.id, QUESTIONS.filter((q) => q.cat === c.id).length]));

// ── Boot & routing ─────────────────────────────────────────────

async function boot() {
  // Start in the language this device chose before, or the phone's own language. A signed-in
  // player's saved choice (below) wins over both.
  const firstLang = savedLang() || deviceLang();
  try {
    const [config, me] = await Promise.all([api('/api/config'), api('/api/me'), loadLocalImages(), setLang(firstLang)]);
    state.config = config;
    state.user = me.user;
    adoptSettings(me.settings);
    await adoptLanguage(me.settings);
  } catch (err) {
    // 503: the server is full (too many players at once); anything else: it's unreachable.
    await setLang(firstLang).catch(() => {});
    const msg = err.status === 503 ? t('app.full') : t('app.unreachable');
    app.innerHTML = `<section class="screen center-screen"><p class="error-text">${esc(msg)}</p></section>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

/** A server error as a message in the current language. */
function errMsg(err) {
  if (err.status === 429) return t('err.rateLimited', { s: err.retryAfter || 60 });
  if (err.status === 503) return t('app.full');
  if (err.status === 401) return t('err.signedOut');
  if (!err.status) return t('err.network');
  return lang() === 'en' ? err.message : t('err.generic'); // the server's own messages are in English
}

// ── Language ───────────────────────────────────────────────────

/**
 * After sign-in: a language saved on the account wins. Otherwise a language picked on this
 * device is saved to the account, and failing both, the Google account's language is used
 * when the device's own language isn't supported.
 */
async function adoptLanguage(settings, googleLocale = null) {
  if (!state.user) return;
  // A language picked on the sign-in screen just now beats the one saved on the account.
  if (pickedWhileSignedOut) {
    pickedWhileSignedOut = false;
    if (settings?.language !== lang()) setSetting('language', lang());
    return;
  }
  if (isLang(settings?.language)) {
    rememberLang(settings.language);
    if (settings.language !== lang()) await setLang(settings.language);
    return;
  }
  if (savedLang()) return setSetting('language', savedLang());
  const fromGoogle = String(googleLocale || '').toLowerCase().split('-')[0].replace('iw', 'he');
  if (deviceLang() === 'en' && isLang(fromGoogle) && fromGoogle !== lang()) await setLang(fromGoogle);
}

let rerendering = false; // true while a screen is redrawn for a language change
let pickedWhileSignedOut = false;

/** Switches language from one of the two pickers and redraws the current screen. */
async function changeLanguage(id) {
  if (!isLang(id) || id === lang()) return;
  await setLang(id);
  rememberLang(id);
  if (state.user) setSetting('language', id);
  else pickedWhileSignedOut = true;
  rerendering = true;
  try {
    await route();
  } finally {
    rerendering = false;
  }
}

/** The three languages as a row of buttons (sign-in screen). */
function langSwitch() {
  return `
    <div class="lang-switch" role="group" aria-label="${esc(t('lang.label'))}">
      ${LANGUAGES.map((l) => `<button type="button" lang="${l.id}" data-lang="${l.id}" aria-pressed="${l.id === lang()}">${esc(l.name)}</button>`).join('')}
    </div>`;
}

/** The language sheet opened from the home screen. */
function openLangSheet(opener) {
  const scrim = document.createElement('div');
  scrim.className = 'sheet-scrim';
  scrim.innerHTML = `
    <div class="sheet lang-sheet" role="dialog" aria-modal="true" aria-labelledby="lang-title">
      <h2 id="lang-title">${esc(t('lang.choose'))}</h2>
      <p>${esc(t('lang.note'))}</p>
      <div class="lang-options">
        ${LANGUAGES.map((l) => `
          <button type="button" class="lang-option" lang="${l.id}" data-lang="${l.id}" aria-pressed="${l.id === lang()}">
            <span>${esc(l.name)}</span>${l.id === lang() ? ICONS.check : ''}
          </button>`).join('')}
      </div>
      <button type="button" class="btn btn-ghost-ink btn-block sheet-done" data-lang-close>${esc(t('common.cancel'))}</button>
    </div>`;
  document.body.append(scrim);
  const close = () => {
    scrim.remove();
    opener?.focus?.({ preventScroll: true });
  };
  scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  scrim.addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-lang]');
    if (pick) {
      scrim.remove();
      await changeLanguage(pick.dataset.lang);
      document.querySelector('[data-lang-open]')?.focus({ preventScroll: true });
      return;
    }
    if (e.target === scrim || e.target.closest('[data-lang-close]')) close();
  });
  scrim.querySelector('[aria-pressed="true"]')?.focus();
}

function go(hash, { replace = false } = {}) {
  if (location.hash === hash) return route();
  if (replace) location.replace(hash); // keeps Back from restarting a finished round
  else location.hash = hash;
}

// ── Settings (per player, saved on the server) ─────────────────

const SETTING_NAMES = ['autoNext', 'autoNextDelay'];
let pendingSettings = null; // changes not yet sent to the server
let settingsTimer = 0;

function getSetting(name, fallback) {
  return state.settings?.[name] ?? fallback;
}

function setSetting(name, value) {
  state.settings = { ...state.settings, [name]: value };
  pendingSettings = { ...pendingSettings, [name]: value };
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(flushSettings, 500); // the delay slider fires on every step
}

function flushSettings({ keepalive = false } = {}) {
  clearTimeout(settingsTimer);
  if (!pendingSettings || !state.user) return;
  const body = JSON.stringify(pendingSettings);
  pendingSettings = null;
  fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive, credentials: 'same-origin' })
    .catch(() => {});
}
window.addEventListener('pagehide', () => flushSettings({ keepalive: true }));

/** Uses the settings the server sent at sign-in. Settings this device kept before they moved to the server are carried over once. */
function adoptSettings(settings) {
  state.settings = settings || {};
  if (settings || !state.user) return;
  const key = (name) => `smarts:${state.user.id}:${name}`;
  try {
    const old = Object.fromEntries(SETTING_NAMES.map((n) => [n, localStorage.getItem(key(n))]).filter(([, v]) => v !== null).map(([n, v]) => [n, JSON.parse(v)]));
    if (!Object.keys(old).length) return;
    state.settings = old;
    setSetting('autoNext', Boolean(autoNextOn()));
    setSetting('autoNextDelay', autoDelaySeconds()); // cleaned up, so the server accepts it
    for (const n of SETTING_NAMES) localStorage.removeItem(key(n));
  } catch { /* private mode or a corrupted value: keep the defaults */ }
}

const autoNextOn = () => getSetting('autoNext', true);

/** The player's auto-next delay, always a whole number of seconds within range. */
function autoDelaySeconds() {
  const raw = getSetting('autoNextDelay', AUTO_DELAY.fallback);
  // Only real numbers (or numeric text) count; null, true, "" etc. fall back to the default.
  const n = (typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '')) ? Math.round(Number(raw)) : NaN;
  if (!Number.isFinite(n)) return AUTO_DELAY.fallback; // corrupted or hand-edited storage
  return Math.min(AUTO_DELAY.max, Math.max(AUTO_DELAY.min, n));
}

async function route() {
  navId += 1;
  closeReport?.();
  cleanup();
  cleanup = () => {};
  document.querySelector('.lang-sheet')?.parentElement.remove();
  if (!rerendering) window.scrollTo(0, 0);
  if (!state.user) return showSignIn();

  const [, page, arg] = (location.hash || '#/').split('/');
  if (page === 'play' && (arg === 'mixed' || arg === 'review' || CATEGORY_BY_ID[arg])) return startRound(arg);
  if (page === 'results' && state.lastRound) return showResults();
  if (page === 'progress') return showProgress();
  if (page === 'admin' && state.user.admin) return showAdmin(arg);
  return showHome();
}

async function loadStats(force = false) {
  if (state.stats && !force) return state.stats;
  const s = await api(`/api/stats?tz=${new Date().getTimezoneOffset()}`);
  // Answers to questions that were removed (e.g. the old Islands topic) stay in the
  // history but don't count toward "x of 400".
  const known = (ids) => ids.filter((id) => QUESTION_BY_ID.has(id));
  s.seenIds = known(s.seenIds);
  s.masteredIds = known(s.masteredIds);
  state.stats = s;
  return s;
}

// ── Sign in ────────────────────────────────────────────────────

function showSignIn() {
  const { googleClientId, devLogin } = state.config;
  const sign = { cat: 'signs' };
  const demoOptions = ['Stop', 'Give way', 'Priority road'];
  app.innerHTML = `
    <section class="screen signin">
      ${langSwitch()}
      <div class="signin-hero" aria-hidden="true">
        <div class="demo-card">
          <div class="demo-fuse"><span></span></div>
          <div class="demo-pic">${signSvg('give-way')}</div>
          <ul class="demo-options">
            ${demoOptions.map((o) => `<li class="${o === 'Give way' ? 'is-correct' : ''}">${esc(qt(sign, o))}</li>`).join('')}
          </ul>
        </div>
      </div>
      <div class="signin-copy">
        <h1 class="logo logo-xl">Smarts</h1>
        <p class="lede">${esc(t('signin.lede', { count: QUESTIONS.length, topics: CATEGORIES.length, secs: MODES[DEFAULT_MODE].secondsPerQuestion }))}</p>
      </div>
      <div class="signin-actions">
        ${googleClientId ? `<div id="google-btn" class="google-btn"></div>` : ''}
        ${!googleClientId ? `<p class="note">${t('signin.noGoogle')}</p>` : ''}
        ${devLogin ? `
          <form class="dev-login" autocomplete="off">
            <label for="dev-name">${esc(t(googleClientId ? 'signin.devOr' : 'signin.dev'))}</label>
            <div class="dev-row">
              <input id="dev-name" name="name" maxlength="40" placeholder="${esc(t('signin.namePlaceholder'))}" required>
              <button class="btn btn-paper" type="submit">${esc(t('signin.continue'))}</button>
            </div>
          </form>` : ''}
        <p class="error-text" id="signin-error" hidden></p>
        <p class="signin-legal"><a href="/privacy">${esc(t('common.privacy'))}</a></p>
      </div>
    </section>`;

  app.querySelector('.lang-switch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (b) changeLanguage(b.dataset.lang);
  });

  const showError = (msg) => {
    const el = document.getElementById('signin-error');
    el.textContent = msg;
    el.hidden = false;
  };

  if (googleClientId) mountGoogleButton(googleClientId, showError);

  app.querySelector('.dev-login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name');
    try {
      const { user, settings } = await api('/api/auth/dev', { method: 'POST', body: { name } });
      await signedIn(user, settings);
    } catch (err) {
      showError(errMsg(err));
    }
  });
}

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(t('signin.googleFailed')));
    document.head.append(s);
  });
}

async function mountGoogleButton(clientId, showError) {
  try {
    await loadGoogleScript();
    google.accounts.id.initialize({
      client_id: clientId,
      ux_mode: 'popup',
      callback: async ({ credential }) => {
        try {
          const { user, settings, locale } = await api('/api/auth/google', { method: 'POST', body: { credential } });
          await signedIn(user, settings, locale);
        } catch (err) {
          showError(errMsg(err));
        }
      },
    });
    const el = document.getElementById('google-btn');
    if (!el) return;
    google.accounts.id.renderButton(el, {
      theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'center',
      width: Math.min(360, Math.max(240, el.clientWidth)),
      locale: lang(), // the button's own text in the chosen language
    });
  } catch (err) {
    showError(err.message);
  }
}

async function signedIn(user, settings, googleLocale = null) {
  state.user = user;
  adoptSettings(settings);
  await adoptLanguage(settings, googleLocale);
  state.stats = null;
  go('#/');
}

/** Signs out of this device, or with `everywhere` ends the player's sessions on every device. */
async function signOut({ everywhere = false } = {}) {
  flushSettings();
  await api(everywhere ? '/api/auth/logout-all' : '/api/auth/logout', { method: 'POST' }).catch(() => {});
  signedOut();
}

function signedOut() {
  window.google?.accounts?.id?.disableAutoSelect();
  state.user = null;
  state.settings = null;
  state.stats = null;
  go('#/');
}

async function deleteAccount(btn) {
  const ok = window.confirm(t('account.deleteConfirm'));
  if (!ok) return;
  btn.disabled = true;
  try {
    await api('/api/account', { method: 'DELETE' });
  } catch (err) {
    btn.disabled = false;
    window.alert(t('account.deleteFailed', { error: errMsg(err) }));
    return;
  }
  pendingSettings = null;
  signedOut();
}

// ── Reporting a question ───────────────────────────────────────

let closeReport = null; // closes the open report sheet, if there is one
const reportOpen = () => !!closeReport;

/** Opens the "Report this question" sheet. Resolves true once a report is sent, false if closed. */
function openReportSheet(q) {
  closeReport?.();
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const reasons = REPORT_REASONS.filter((r) => !r.picture || q.visual.type !== 'text');
    const scrim = document.createElement('div');
    scrim.className = 'sheet-scrim';
    scrim.innerHTML = `
      <form class="sheet report-sheet" role="dialog" aria-modal="true" aria-labelledby="report-title" novalidate>
        <h2 id="report-title">${esc(t('report.title'))}</h2>
        <p class="report-q">${esc(qt(q, q.prompt))} <strong>${esc(t('report.answer', { answer: qt(q, q.answer) }))}</strong></p>
        <fieldset class="report-reasons">
          <legend>${esc(t('report.whatsWrong'))}</legend>
          ${reasons.map((r) => `<label class="report-reason"><input type="radio" name="reason" value="${r.id}"><span>${esc(reasonLabel(r))}</span></label>`).join('')}
        </fieldset>
        <label class="report-note">
          <span>${esc(t('report.addNote'))} <small>${esc(t('report.optional'))}</small></span>
          <textarea name="note" rows="2" maxlength="${REPORT_NOTE_MAX}" placeholder="${esc(t('report.notePlaceholder'))}"></textarea>
        </label>
        <p class="report-error" role="alert" hidden></p>
        <div class="sheet-actions">
          <button type="button" class="btn btn-ghost-ink" data-report-cancel>${esc(t('common.cancel'))}</button>
          <button type="submit" class="btn btn-marigold" data-report-send>${esc(t('report.send'))}</button>
        </div>
      </form>`;
    document.body.append(scrim);
    const form = scrim.querySelector('form');
    const error = scrim.querySelector('.report-error');
    const sendBtn = scrim.querySelector('[data-report-send]');

    const close = (sent) => {
      if (!scrim.isConnected) return;
      scrim.remove();
      closeReport = null;
      opener?.focus?.({ preventScroll: true });
      resolve(sent);
    };
    closeReport = () => close(false);

    // Keys typed here (digits, Enter, space) must not reach the game underneath.
    scrim.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close(false);
    });
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim || e.target.closest('[data-report-cancel]')) close(false);
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const reason = form.elements.reason.value;
      if (!reason) {
        error.textContent = t('report.pick');
        error.hidden = false;
        return;
      }
      sendBtn.disabled = true;
      sendBtn.textContent = t('report.sending');
      try {
        await api('/api/reports', { method: 'POST', body: { questionId: q.id, reason, note: form.elements.note.value } });
        close(true);
      } catch (err) {
        error.textContent = t('report.failed', { error: errMsg(err) });
        error.hidden = false;
        sendBtn.disabled = false;
        sendBtn.textContent = t('report.send');
      }
    });
    scrim.querySelector('input[name="reason"]').focus();
  });
}

const reportBtn = () => `<button class="icon-btn report-btn" data-report aria-label="${esc(t('report.button'))}" title="${esc(t('report.button'))}">${ICONS.report}</button>`;

const reportedIds = new Set(); // questions reported during this visit

/** Turns a report button into a "reported" mark. */
function markReported(btn, q) {
  if (q) reportedIds.add(q.id);
  btn.disabled = true;
  btn.classList.add('is-done');
  btn.setAttribute('aria-label', t('report.thanks'));
  btn.title = t('report.thanks');
}

// ── Shared chrome ──────────────────────────────────────────────

function avatar(user, size = 36) {
  const initial = esc((user.name || '?').trim()[0]?.toUpperCase() || '?');
  return user.picture
    ? `<img class="avatar" src="${esc(user.picture)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer">`
    : `<span class="avatar avatar-initial" style="width:${size}px;height:${size}px">${initial}</span>`;
}

function tabbar(active) {
  return `
    <nav class="tabbar" aria-label="Main">
      <a href="#/" class="${active === 'home' ? 'is-active' : ''}" ${active === 'home' ? 'aria-current="page"' : ''}>${ICONS.play}<span>${esc(t('tab.play'))}</span></a>
      <a href="#/progress" class="${active === 'progress' ? 'is-active' : ''}" ${active === 'progress' ? 'aria-current="page"' : ''}>${ICONS.chart}<span>${esc(t('tab.progress'))}</span></a>
    </nav>`;
}

// ── Home ───────────────────────────────────────────────────────

// New players get an animated "Tap to play!" hint on the Quick round card for their first
// few visits to the home screen. Counted on this device, per player.
const QUICK_HINT_VISITS = 5;
let lastQuickHint = false;

// The home screen previews a few topics under the Quick round card, with a button to
// show the rest. Opened stays opened while the app is open, so redraws don't fold it again.
const TOPIC_PREVIEW = 3;
let topicsOpen = false;
// Topics the player has answered most come first, so the preview shows their own topics.
// Kept between draws: stats are briefly missing after a round, and the list shouldn't jump.
let topicOrder = CATEGORIES;

function orderTopics(stats) {
  if (!stats) return topicOrder;
  const answered = Object.fromEntries(stats.byCategory.map((c) => [c.category, c.answered]));
  return (topicOrder = [...CATEGORIES].sort((a, b) => (answered[b.id] || 0) - (answered[a.id] || 0)));
}

function takeQuickHint(userId) {
  const key = `smarts:${userId}:quickHintsShown`;
  try {
    const shown = Number(localStorage.getItem(key)) || 0;
    if (shown >= QUICK_HINT_VISITS) return false;
    localStorage.setItem(key, String(shown + 1));
    return true;
  } catch {
    return false; // storage blocked: skip the hint rather than show it forever
  }
}

async function showHome() {
  const user = state.user;
  const firstName = esc(user.name.split(' ')[0]);
  // Once per visit, though the screen is drawn twice; a language change redraws without counting.
  const hint = rerendering ? lastQuickHint : (lastQuickHint = takeQuickHint(user.id));
  const draw = (stats) => {
    const mastered = Object.fromEntries((stats?.byCategory || []).map((c) => [c.category, c.mastered]));
    const totalMastered = stats ? stats.masteredIds.length : 0;
    const current = LANGUAGES.find((l) => l.id === lang());
    app.innerHTML = `
      <section class="screen home has-tabbar">
        <header class="topbar">
          <span class="logo">Smarts</span>
          <span class="topbar-end">
            <button type="button" class="lang-btn" data-lang-open aria-haspopup="dialog" aria-label="${esc(t('lang.change'))}">${ICONS.globe}<span lang="${current.id}">${esc(current.name)}</span></button>
            <a href="#/progress" class="avatar-link" aria-label="${esc(t('home.yourProgress'))}">${avatar(user)}</a>
          </span>
        </header>

        <h1 class="greeting">${esc(t('home.hi', { name: firstName }))}</h1>
        <p class="sub">${stats ? esc(t('home.sub', { n: totalMastered, total: QUESTIONS.length })) : '&nbsp;'}</p>

        <a class="quick ${hint ? 'is-hinting' : ''}" href="#/play/mixed">
          ${hint ? `<span class="quick-hint" aria-hidden="true">${esc(t('quick.hint'))}</span>` : ''}
          <span class="quick-text">
            <strong>${esc(t('quick.title'))}</strong>
            <span>${esc(t('quick.desc', { n: MODES[DEFAULT_MODE].questionsPerRound }))}</span>
          </span>
          <span class="quick-go" aria-hidden="true"><span>${esc(t('quick.play'))}</span>${ICONS.play}</span>
        </a>

        <h2 class="section-title">${esc(t('home.topics'))}</h2>
        <ul class="topics ${topicsOpen ? '' : 'is-folded'}" id="topic-list">
          ${orderTopics(stats).map((c) => {
            const m = mastered[c.id] || 0;
            const total = CAT_COUNT[c.id];
            return `
              <li>
                <a class="topic" href="#/play/${c.id}" style="--hue:${c.hue}">
                  <span class="topic-icon">${ICONS[c.id]}</span>
                  <span class="topic-text">
                    <strong>${esc(catName(c))}</strong>
                    <span>${esc(catBlurb(c))}</span>
                  </span>
                  <span class="topic-meter" aria-label="${esc(t('home.topicMeter', { m, total }))}">
                    <span class="topic-count">${m}<small>/${total}</small></span>
                    <span class="meter"><span style="width:${(m / total) * 100}%"></span></span>
                  </span>
                </a>
              </li>`;
          }).join('')}
        </ul>
        <button type="button" class="see-all" aria-controls="topic-list" aria-expanded="${topicsOpen}">
          <span>${esc(topicsOpen ? t('home.seeFewer') : t('home.seeAll', { n: CATEGORIES.length }))}</span>
          <span class="see-all-arrow" aria-hidden="true"></span>
        </button>
      </section>
      ${tabbar('home')}`;
    app.querySelector('[data-lang-open]').addEventListener('click', (e) => openLangSheet(e.currentTarget));
    app.querySelector('.see-all').addEventListener('click', (e) => {
      topicsOpen = !topicsOpen;
      const btn = e.currentTarget;
      app.querySelector('#topic-list').classList.toggle('is-folded', !topicsOpen);
      btn.setAttribute('aria-expanded', String(topicsOpen));
      btn.firstElementChild.textContent = topicsOpen ? t('home.seeFewer') : t('home.seeAll', { n: CATEGORIES.length });
      // Bring the rows that just appeared into view, above the floating tab bar, so it's
      // clear something happened even on a short phone.
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      const target = topicsOpen ? app.querySelector(`#topic-list > li:nth-child(${TOPIC_PREVIEW + 1})`) : app.querySelector('.section-title');
      target?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: topicsOpen ? 'center' : 'start' });
    });
  };
  const nav = navId;
  draw(state.stats);
  try {
    const stats = await loadStats();
    if (nav === navId) draw(stats);
  } catch (err) {
    if (err.status === 401) return signOut();
  }
}

// ── Round ──────────────────────────────────────────────────────

const roundTitle = (cat) =>
  cat === 'mixed' ? t('round.quick') : cat === 'review' ? t('round.review') : CATEGORY_BY_ID[cat] ? catName(CATEGORY_BY_ID[cat]) : cat;

// Questions of the round played last in this visit, in case the server's stats lag behind.
let lastPlayedIds = new Set();

// Quick rounds bring back this many questions you recently got wrong (fewer if there aren't enough).
const RETRY_MIN = 3;
const RETRY_MAX = 5;

/**
 * Orders a pool for picking: new questions first, then ones you've missed, then ones you
 * already know. Questions from the round just played always go last, so they only come
 * back when nothing else is left.
 */
function orderForPlay(pool, stats) {
  const seen = new Set(stats?.seenIds || []);
  const mastered = new Set(stats?.masteredIds || []);
  const recent = new Set([...(stats?.lastRoundIds || []), ...lastPlayedIds]);
  const fresh = pool.filter((q) => !recent.has(q.id));
  return [
    ...shuffle(fresh.filter((q) => !seen.has(q.id))),
    ...shuffle(fresh.filter((q) => seen.has(q.id) && !mastered.has(q.id))),
    ...shuffle(fresh.filter((q) => mastered.has(q.id))),
    ...shuffle(pool.filter((q) => recent.has(q.id))),
  ];
}

function pickQuestions(cat, n, stats) {
  if (cat === 'review') {
    // The questions you've missed most, most-missed first.
    const ids = (stats?.missed || []).map((m) => m.id).filter((id) => QUESTION_BY_ID.has(id));
    return shuffle(ids.slice(0, n).map((id) => QUESTION_BY_ID.get(id)));
  }
  // Book topics and Programming are only played from their own tile, never in a Quick round.
  const inQuick = (q) => !CATEGORY_BY_ID[q.cat]?.book && CATEGORY_BY_ID[q.cat]?.quick !== false;
  const pool = (cat === 'mixed' ? QUESTIONS.filter(inQuick) : QUESTIONS.filter((q) => q.cat === cat))
    .filter((q) => !failedPictures.has(q.id));
  const inPool = new Set(pool.map((q) => q.id));

  // Never two questions about the same country in one round: "What's the capital of
  // Japan?" shows Japan's flag and names Japan, giving away its flag and shape questions.
  const pictureKey = (q) => (q.about ? `country:${q.about.toLowerCase()}` : q.id);
  const perCatLimit = cat === 'mixed' ? 2 : Infinity;
  const perCat = {};
  const usedPictures = new Set();
  const picked = [];
  const take = (q, { limitTopic = true } = {}) => {
    if (picked.length === n || picked.includes(q)) return;
    if (limitTopic && (perCat[q.cat] || 0) >= perCatLimit) return;
    if (usedPictures.has(pictureKey(q))) return;
    perCat[q.cat] = (perCat[q.cat] || 0) + 1;
    usedPictures.add(pictureKey(q));
    picked.push(q);
  };

  if (cat === 'mixed') {
    // A few recent mistakes come back for another try, but never ones from the round just played.
    const recent = new Set([...(stats?.lastRoundIds || []), ...lastPlayedIds]);
    const retries = shuffle((stats?.recentMissed || []).filter((id) => inPool.has(id) && !recent.has(id)).map((id) => QUESTION_BY_ID.get(id)));
    const want = RETRY_MIN + Math.floor(Math.random() * (RETRY_MAX - RETRY_MIN + 1));
    for (const q of retries) {
      if (picked.length >= want) break;
      take(q);
    }
  }
  for (const q of orderForPlay(pool, stats)) take(q);
  return cat === 'mixed' ? shuffle(picked) : picked;
}

const PICTURE_RETRIES = 3;
const PICTURE_RETRY_GAP_MS = 2000;
const MAX_SWAPS = 10; // safety cap per round; being offline is detected when no replacement loads
const failedPictures = new Set(); // question ids whose picture wouldn't load this session

/**
 * Another question for the same slot when a picture won't load. Picks in the same order as
 * a new round (new questions first, the last round's last), preferring the best group whose
 * picture is already downloaded; otherwise downloads a few candidates at once and returns
 * the first whose picture actually arrives.
 */
async function pickReplacement(round, failed, stats) {
  failedPictures.add(failed.id);
  const used = new Set(round.questions.map((q) => q.id));
  const usedAbout = new Set(round.questions.filter((q) => q !== failed && q.about).map((q) => q.about.toLowerCase()));
  const pool = QUESTIONS.filter(
    (q) =>
      q.cat === failed.cat &&
      !used.has(q.id) &&
      !failedPictures.has(q.id) &&
      !(q.about && usedAbout.has(q.about.toLowerCase()))
  );
  if (!pool.length) return null;
  const ordered = orderForPlay(pool, stats);
  // Only take an already-downloaded picture from among the first few candidates, so a
  // failed picture never pulls back a question you just played.
  const best = ordered.slice(0, Math.max(4, Math.ceil(ordered.length / 3)));
  const ready = best.find(isPreloaded);
  if (ready) return ready;
  const candidates = ordered.slice(0, 4);
  const attempts = candidates.map((c) =>
    fetchNow(c).then((ok) => {
      if (!ok) failedPictures.add(c.id); // only pictures that really failed are remembered
      return ok ? c : Promise.reject(c);
    })
  );
  return Promise.race([
    Promise.any(attempts).catch(() => null),
    new Promise((r) => setTimeout(() => r(null), 10000)),
  ]);
}

function answersPayload(results) {
  return results.filter((r) => !r.skipped).map((r) => ({ id: r.q.id, choice: r.choice, ms: r.ms }));
}

async function startRound(cat) {
  const nav = navId;
  const mode = DEFAULT_MODE;
  const cfg = MODES[mode];
  let stats = state.stats;
  // Review and Quick rounds depend on what you just played, so they always use fresh stats.
  const needFresh = cat === 'review' || cat === 'mixed';
  if (!stats || needFresh) stats = await loadStats(needFresh).catch(() => stats);
  if (nav !== navId) return; // the player went somewhere else while stats loaded

  const round = {
    cat, mode, cfg,
    questions: pickQuestions(cat, cfg.questionsPerRound, stats),
    idx: 0,
    results: [], // { q, choice, correct, ms, points, skipped }
    score: 0,
    streak: 0,
    bestStreak: 0,
    saved: false, // set once answers have been sent to the server
    swaps: 0, // questions replaced because their picture wouldn't load
  };
  if (!round.questions.length) return go('#/', { replace: true });

  const title = roundTitle(cat);
  app.innerHTML = `
    <section class="screen play">
      <header class="play-top">
        <button class="icon-btn" data-quit aria-label="${esc(t('play.quit'))}">${ICONS.close}</button>
        <ol class="pips" aria-label="${esc(t('play.progress', { title }))}">
          ${round.questions.map(() => '<li></li>').join('')}
        </ol>
        <button class="auto-toggle" data-auto aria-haspopup="dialog" aria-expanded="false">
          <span class="auto-switch" aria-hidden="true"></span><span class="auto-label" data-auto-label></span>
        </button>
        <span class="play-score" aria-label="${esc(t('play.score'))}"><span data-score>0</span></span>
      </header>
      <div class="fuse-row">
        <div class="fuse" role="timer" aria-label="${esc(t('play.timeLeft'))}"><span class="fuse-fill"></span><span class="fuse-spark"></span></div>
        <span class="fuse-secs" data-secs>${cfg.secondsPerQuestion}</span>
      </div>
      <div class="stage" data-stage></div>
      <p class="paused-note" data-paused-note hidden>${esc(t('play.paused'))}</p>
      <div class="dock" data-dock hidden></div>
      <div class="sheet-scrim" data-auto-sheet hidden>
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="auto-title">
          <h2 id="auto-title">${esc(t('auto.title'))}</h2>
          <p>${esc(t('auto.pausedNote'))}</p>
          <label class="setting">
            <span><strong>${esc(t('auto.moveOn'))}</strong><span>${esc(t('auto.moveOnHint'))}</span></span>
            <input type="checkbox" class="switch" data-auto-on>
          </label>
          <div class="setting setting-range" data-auto-delay-row>
            <label for="play-delay"><strong>${esc(t('auto.wait'))}</strong><span>${esc(t('auto.waitHint'))}</span></label>
            <div class="range-row">
              <input type="range" id="play-delay" min="${AUTO_DELAY.min}" max="${AUTO_DELAY.max}" step="1" data-auto-delay>
              <output for="play-delay" data-auto-delay-out></output>
            </div>
          </div>
          <button class="btn btn-marigold btn-block sheet-done" data-auto-done>${esc(t('common.done'))}</button>
        </div>
      </div>
      <div class="sheet-scrim" data-sheet hidden>
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="quit-title">
          <h2 id="quit-title">${esc(t('quit.title'))}</h2>
          <p data-quit-note></p>
          <div class="sheet-actions">
            <button class="btn btn-ghost-ink" data-keep>${esc(t('quit.keep'))}</button>
            <button class="btn btn-coral" data-confirm-quit>${esc(t('quit.confirm'))}</button>
          </div>
        </div>
      </div>
    </section>`;

  const $ = (sel) => app.querySelector(sel);
  const screen = $('.play');
  const stage = $('[data-stage]');
  const dock = $('[data-dock]');
  const pips = [...app.querySelectorAll('.pips li')];
  const fuseFill = $('.fuse-fill');
  const fuseSpark = $('.fuse-spark');
  const fuseRow = $('.fuse-row');
  const secsEl = $('[data-secs]');
  const scoreEl = $('[data-score]');
  const autoBtn = $('[data-auto]');
  const quitSheet = $('[data-sheet]');
  const pausedNote = $('[data-paused-note]');

  let raf = 0;
  let advanceTimer = 0;
  let current = null; // { q, options, start, answered, outcome, preloaded }
  let alive = true;
  let pausedAt = 0; // performance.now() when paused, 0 while running
  let leavingTo = null; // hash to go to once the history guard entry is popped

  const nextQuestion = () => round.questions[round.idx + 1];
  const timing = () => current && current.start && !current.answered;

  const setFuse = (frac) => {
    const f = Math.max(0, Math.min(1, frac));
    fuseFill.style.transform = `scaleX(${f})`;
    fuseSpark.style.insetInlineStart = `${f * 100}%`; // left in English, right in Hebrew and Arabic
  };

  function tick() {
    if (!timing() || pausedAt) return;
    const elapsed = performance.now() - current.start;
    const limitMs = current.limitMs;
    const left = Math.max(0, limitMs - elapsed);
    setFuse(left / limitMs);
    secsEl.textContent = Math.ceil(left / 1000);
    fuseRow.classList.toggle('is-low', left <= 5000);
    if (left <= 2000 && !current.preloaded) {
      current.preloaded = true;
      preload(nextQuestion()); // second chance, in case the early preload failed
    }
    if (left <= 0) return answer(null);
    raf = requestAnimationFrame(tick);
  }

  // ── Pause: used by the quit sheet and when the app goes to the background ──

  function pause({ hide = false } = {}) {
    if (!pausedAt) {
      pausedAt = performance.now();
      cancelAnimationFrame(raf);
      clearTimeout(advanceTimer);
      dock.querySelector('.btn-next')?.classList.remove('is-counting');
      fuseRow.classList.add('is-paused');
    }
    // Hide the question so time away can't be used to look the answer up.
    if (hide && timing()) {
      screen.classList.add('is-hidden');
      pausedNote.hidden = false;
    }
  }

  function resume() {
    if (!pausedAt || !alive) return;
    if (current?.start) current.start += performance.now() - pausedAt; // time away doesn't count
    pausedAt = 0;
    screen.classList.remove('is-hidden');
    pausedNote.hidden = true;
    fuseRow.classList.remove('is-paused');
    if (timing()) raf = requestAnimationFrame(tick);
    else if (current?.answered) scheduleAutoNext();
  }

  // ── Questions ──

  async function showQuestion() {
    const q = round.questions[round.idx];
    const options = shuffle([q.answer, ...q.wrong]);
    const seconds = secondsFor(q, cfg);
    current = { q, options, start: 0, answered: false, outcome: null, preloaded: false, seconds, limitMs: seconds * 1000 };
    const token = current;

    window.scrollTo(0, 0); // the last answer may have scrolled the page
    pips.forEach((p, i) => p.classList.toggle('is-current', i === round.idx));
    dock.hidden = true;
    dock.innerHTML = '';
    fuseRow.classList.remove('is-low', 'is-done');
    fuseRow.classList.add('is-waiting');
    setFuse(1);
    secsEl.textContent = seconds;

    const vis = renderVisual(q);
    const topic = CATEGORY_BY_ID[q.cat];
    const head =
      q.visual.type === 'text'
        ? `<div class="qcard" style="--hue:${topic.hue}">
             <p class="qcard-source">${esc(topic.book ? t('q.byAuthor', { topic: catName(topic), author: catBlurb(topic) }) : catName(topic))}</p>
             <p class="qcard-text" id="prompt">${esc(qt(q, q.prompt))}</p>
           </div>`
        : `<figure class="pic pic-${q.visual.type}">${vis.html}<p class="pic-loading" hidden>${esc(t('q.loading'))}</p></figure>
           <p class="prompt" id="prompt">${esc(qt(q, q.prompt))}</p>`;
    // Options are kept in English (that's what is graded) and shown translated.
    stage.innerHTML = `
      ${head}
      <div class="answers is-waiting" role="group" aria-labelledby="prompt">
        ${options.map((o, i) => `<button class="answer" data-i="${i}" disabled><kbd>${i + 1}</kbd><span>${esc(qt(q, o))}</span></button>`).join('')}
      </div>`;
    stage.classList.remove('enter');
    void stage.offsetWidth;
    stage.classList.add('enter');

    // Download the next two pictures now, in order, while this one is on screen.
    preload(nextQuestion());
    preload(round.questions[round.idx + 2]);

    // On a slow connection, say so instead of showing a blank card. The clock waits.
    const slowNote = stage.querySelector('.pic-loading');
    const slowTimer = setTimeout(() => slowNote && (slowNote.hidden = false), 900);
    const within = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(() => r(false), ms))]);
    let ok = await within(vis.ready(stage), 20000);

    // A picture that fails gets a few more tries, 2 seconds apart, before giving up.
    for (let attempt = 1; !ok && attempt <= PICTURE_RETRIES && alive && current === token; attempt++) {
      if (slowNote) slowNote.hidden = false;
      await new Promise((r) => setTimeout(r, PICTURE_RETRY_GAP_MS));
      if (!alive || current !== token) return;
      const retry = renderVisual(q);
      const pic = stage.querySelector('.pic');
      pic.querySelector('.vis')?.remove();
      pic.insertAdjacentHTML('afterbegin', retry.html);
      ok = await within(retry.ready(stage), 8000);
    }
    clearTimeout(slowTimer);
    slowNote?.remove();
    if (!alive || current !== token) return;

    // Still no picture: swap in another question from the same topic (preferring one
    // whose picture has already downloaded), so the player never meets a dead question.
    if (!ok && round.swaps < MAX_SWAPS) {
      round.swaps += 1;
      const replacement = await pickReplacement(round, q, stats);
      if (!alive || current !== token) return;
      if (replacement) {
        round.questions[round.idx] = replacement;
        return showQuestion();
      }
    }

    fuseRow.classList.remove('is-waiting');
    if (!ok) {
      // The picture failed or is too slow: offer a skip that doesn't count.
      const pic = stage.querySelector('.pic .vis');
      if (pic) pic.outerHTML = `<div class="vis vis-photo">${missingHtml()}</div>`;
      current.answered = true;
      current.outcome = 'skipped';
      round.results.push({ q, choice: null, correct: false, ms: 0, points: 0, skipped: true });
      pips[round.idx].classList.add('is-skipped');
      showDock(`<p class="dock-msg">${esc(t('q.noPicture'))}</p>${reportBtn()}<button class="btn btn-marigold btn-next" data-next><span>${esc(t('q.skip'))}</span></button>`);
      scheduleAutoNext();
      return;
    }

    // Options appear together with the picture, so nobody gets a head start reading them.
    stage.querySelector('.answers').classList.remove('is-waiting');
    stage.querySelectorAll('.answer').forEach((b) => (b.disabled = false));
    current.start = performance.now();
    if (pausedAt) {
      // Went to the background while the picture loaded: start paused and hidden.
      pausedAt = current.start;
      pause({ hide: document.hidden });
    } else {
      raf = requestAnimationFrame(tick);
    }
  }

  function answer(choice) {
    if (!timing() || pausedAt) return;
    current.answered = true;
    cancelAnimationFrame(raf);
    const { q } = current;
    const ms = Math.round(performance.now() - current.start);
    const correct = choice === q.answer;
    const points = pointsFor(correct, ms, current.seconds);

    round.score += points;
    round.streak = correct ? round.streak + 1 : 0;
    round.bestStreak = Math.max(round.bestStreak, round.streak);
    round.results.push({ q, choice, correct, ms, points, skipped: false });

    scoreEl.textContent = round.score;
    pips[round.idx].classList.add(correct ? 'is-right' : 'is-wrong');
    fuseRow.classList.add('is-done');

    stage.querySelectorAll('.answer').forEach((b) => {
      const text = current.options[Number(b.dataset.i)];
      b.disabled = true;
      if (text === q.answer) b.classList.add('is-correct');
      else if (text === choice) b.classList.add('is-wrong');
      else b.classList.add('is-dim');
    });

    if (!correct) navigator.vibrate?.(70);
    current.outcome = correct ? 'right' : 'wrong';
    preload(nextQuestion()); // no-op if it's already cached

    // Short answers stay on one line ("No U-turn" shouldn't split); long ones wrap.
    const shown = qt(q, q.answer);
    const long = shown.length > 22;
    const ans = `<b class="${long ? 'is-long' : ''}">${esc(shown)}</b>`;
    const reveal = t(long ? 'q.answerIs' : 'q.its', { answer: ans });
    const msg = correct
      ? `<p class="dock-msg is-right">${ICONS.check}<span>${t('q.right', { points })}</span></p>`
      : choice === null
        ? `<p class="dock-msg is-wrong">${ICONS.clock}<span>${esc(t('q.outOfTime'))} ${reveal}</span></p>`
        : `<p class="dock-msg is-wrong">${ICONS.cross}<span>${reveal}</span></p>`;
    const last = round.idx === round.questions.length - 1;
    showDock(`${msg}${reportBtn()}<button class="btn btn-marigold btn-next" data-next><span>${esc(t(last ? 'q.seeResults' : 'q.next'))}</span></button>`);

    // Keep the right answer visible above the result bar on short screens.
    const rightBtn = stage.querySelector('.answer.is-correct');
    requestAnimationFrame(() => {
      if (!rightBtn || dock.hidden) return;
      const covered = rightBtn.getBoundingClientRect().bottom > dock.getBoundingClientRect().top - 8;
      if (covered) rightBtn.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    });

    scheduleAutoNext();
  }

  function scheduleAutoNext() {
    clearTimeout(advanceTimer);
    const btn = dock.querySelector('.btn-next');
    btn?.classList.remove('is-counting');
    if (!current?.answered || pausedAt || !autoNextOn()) return;
    // Read when the countdown starts and fixed until it ends; settings can only change
    // while the game is paused, and a paused countdown is restarted with the new value.
    const ms = autoDelaySeconds() * 1000;
    if (btn) {
      btn.style.setProperty('--auto-ms', `${ms}ms`);
      void btn.offsetWidth;
      btn.classList.add('is-counting');
    }
    advanceTimer = setTimeout(next, ms);
  }

  const autoSheet = $('[data-auto-sheet]');
  const autoOn = $('[data-auto-on]');
  const autoDelay = $('[data-auto-delay]');
  const autoDelayOut = $('[data-auto-delay-out]');
  const autoDelayRow = $('[data-auto-delay-row]');

  function paintAuto() {
    const on = autoNextOn();
    const secs = autoDelaySeconds();
    autoBtn.classList.toggle('is-on', on);
    $('[data-auto-label]').textContent = on ? t('auto.on', { s: secs }) : t('auto.off');
    autoBtn.setAttribute('aria-label', on ? t('auto.ariaOn', { s: secs }) : t('auto.ariaOff'));
    autoOn.checked = on;
    autoDelay.value = String(secs);
    autoDelay.disabled = !on;
    autoDelayRow.classList.toggle('is-off', !on);
    autoDelayOut.textContent = t('unit.seconds', { s: secs });
  }

  const sheetOpen = () => !quitSheet.hidden || !autoSheet.hidden || reportOpen();

  // Reporting is offered once the question is answered (or skipped), so it can't be used
  // to stop the clock. The game is paused while the sheet is open.
  async function reportCurrent(btn) {
    if (!current?.answered || sheetOpen()) return;
    const q = current.q;
    pause();
    const sent = await openReportSheet(q);
    if (sent) markReported(btn, q);
    if (alive && !document.hidden) resume();
  }

  function openAuto() {
    if (sheetOpen()) return;
    paintAuto();
    pause();
    autoSheet.hidden = false;
    autoBtn.setAttribute('aria-expanded', 'true');
    autoOn.focus();
  }

  function closeAuto() {
    autoSheet.hidden = true;
    autoBtn.setAttribute('aria-expanded', 'false');
    autoBtn.focus({ preventScroll: true });
    if (!document.hidden) resume(); // restarts any countdown with the new settings
  }

  autoOn.addEventListener('change', () => {
    setSetting('autoNext', autoOn.checked);
    paintAuto();
  });
  autoDelay.addEventListener('input', () => {
    const secs = Math.min(AUTO_DELAY.max, Math.max(AUTO_DELAY.min, Math.round(Number(autoDelay.value)) || AUTO_DELAY.fallback));
    setSetting('autoNextDelay', secs);
    paintAuto();
  });
  paintAuto();

  function showDock(html) {
    dock.innerHTML = html;
    dock.hidden = false;
    dock.querySelector('[data-next]')?.focus({ preventScroll: true });
  }

  function next() {
    clearTimeout(advanceTimer);
    // Guard against double triggers (auto timer + tap, or Enter + click).
    if (!alive || pausedAt || !current?.answered) return;
    current = null;
    round.idx += 1;
    if (round.idx >= round.questions.length) return finish();
    showQuestion();
  }

  // ── Leaving: finish, quit, Back gesture, closing the tab ──

  // A guard history entry, so the phone's Back gesture opens the quit sheet
  // instead of silently dropping the round.
  history.pushState({ smartsGuard: true }, '', location.hash);

  function leave(hash) {
    alive = false;
    cancelAnimationFrame(raf);
    clearTimeout(advanceTimer);
    if (history.state?.smartsGuard) {
      leavingTo = hash;
      history.back(); // pop the guard; onPopState finishes the move
    } else {
      go(hash, { replace: true });
    }
  }

  const rememberPlayed = () => {
    lastPlayedIds = new Set(round.results.filter((r) => !r.skipped).map((r) => r.q.id));
  };

  async function finish() {
    const record = { ...round, saved: null, error: null, payload: answersPayload(round.results) };
    round.saved = true;
    rememberPlayed();
    state.lastRound = record;
    leave('#/results');
    await saveRecord(record);
  }

  function savePartial({ beacon = false } = {}) {
    if (round.saved) return;
    round.saved = true;
    rememberPlayed();
    const answers = answersPayload(round.results);
    if (!answers.length) return;
    const body = JSON.stringify({ mode: round.mode, category: round.cat, answers, partial: true });
    state.stats = null;
    if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/rounds', new Blob([body], { type: 'application/json' }));
    else fetch('/api/rounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }

  function openQuit() {
    if (!autoSheet.hidden) closeAuto();
    const done = round.results.filter((r) => !r.skipped).length;
    $('[data-quit-note]').textContent = done ? tn('quit.noteSome', done) : t('quit.noteNone');
    pause();
    quitSheet.hidden = false;
    quitSheet.querySelector('[data-keep]').focus();
  }

  function closeQuit() {
    quitSheet.hidden = true;
    if (!document.hidden) resume();
  }

  function confirmQuit() {
    // If the current question is on screen but unanswered, it simply isn't counted.
    savePartial();
    leave('#/');
  }

  const onPopState = () => {
    if (leavingTo) {
      const to = leavingTo;
      leavingTo = null;
      location.replace(to); // fires hashchange → route()
      return;
    }
    if (!alive) return;
    // Back was pressed: put the guard back and ask.
    history.pushState({ smartsGuard: true }, '', location.hash);
    if (reportOpen()) closeReport();
    else if (!autoSheet.hidden) closeAuto();
    else if (quitSheet.hidden) openQuit();
    else closeQuit();
  };

  const onVisibility = () => {
    if (document.hidden) pause({ hide: true });
    else if (!sheetOpen()) resume();
  };

  const onPageHide = () => savePartial({ beacon: true });

  const onClick = (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.classList.contains('answer')) return current && answer(current.options[Number(t.dataset.i)]);
    if (t.hasAttribute('data-next')) return next();
    if (t.hasAttribute('data-report')) return reportCurrent(t);
    if (t.hasAttribute('data-auto')) return openAuto();
    if (t.hasAttribute('data-auto-done')) return closeAuto();
    if (t.hasAttribute('data-quit')) return openQuit();
    if (t.hasAttribute('data-keep')) return closeQuit();
    if (t.hasAttribute('data-confirm-quit')) return confirmQuit();
  };

  const onKey = (e) => {
    if (reportOpen()) return;
    if (!autoSheet.hidden) {
      if (e.key === 'Escape') closeAuto();
      return;
    }
    if (!quitSheet.hidden) {
      if (e.key === 'Escape') closeQuit();
      return;
    }
    if (e.key === 'Escape') return openQuit();
    if (timing() && /^[1-5]$/.test(e.key)) {
      const btn = stage.querySelector(`.answer[data-i="${Number(e.key) - 1}"]`);
      if (btn && !btn.disabled) answer(current.options[Number(e.key) - 1]);
    } else if (current?.answered && (e.key === 'Enter' || e.key === ' ') && !dock.hidden) {
      e.preventDefault(); // stops the focused Next button from also firing a click
      next();
    }
  };

  autoSheet.addEventListener('click', (e) => { if (e.target === autoSheet) closeAuto(); });
  app.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('popstate', onPopState);
  window.addEventListener('pagehide', onPageHide);
  cleanup = () => {
    alive = false;
    cancelAnimationFrame(raf);
    clearTimeout(advanceTimer);
    app.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    // Keep listening until the guard pop has been handled.
    if (!leavingTo) window.removeEventListener('popstate', onPopState);
    else {
      const original = onPopState;
      window.removeEventListener('popstate', original);
      window.addEventListener('popstate', () => { if (leavingTo) original(); }, { once: true });
    }
  };

  round.questions.slice(0, 3).forEach(preload);
  showQuestion();
}

async function saveRecord(record) {
  if (!record.payload.length) return;
  record.error = null;
  try {
    record.saved = await api('/api/rounds', {
      method: 'POST',
      body: { mode: record.mode, category: record.cat, answers: record.payload },
    });
    state.stats = null;
    loadStats(true).catch(() => {});
  } catch (err) {
    record.error = err.status === 401 ? t('save.signedOut') : errMsg(err);
  }
  if (location.hash === '#/results' && state.lastRound === record) showResults();
}

// ── Results ────────────────────────────────────────────────────

function showResults() {
  const r = state.lastRound;
  const counted = r.results.filter((x) => !x.skipped);
  const right = counted.filter((x) => x.correct).length;
  const rightMs = counted.filter((x) => x.correct).map((x) => x.ms);
  const avg = rightMs.length ? (rightMs.reduce((a, b) => a + b, 0) / rightMs.length / 1000).toFixed(1) : null;
  const title = roundTitle(r.cat);
  const verdict = t(
    !counted.length ? 'res.none'
      : right === counted.length ? 'res.perfect'
      : right >= counted.length * 0.8 ? 'res.sharp'
        : right >= counted.length * 0.5 ? 'res.solid'
          : 'res.learn',
  );

  app.innerHTML = `
    <section class="screen results">
      <header class="topbar">
        <span class="logo">Smarts</span>
        <span class="results-topic">${esc(title)}</span>
      </header>

      <div class="score-hero">
        <p class="score-big">${r.score}</p>
        <p class="score-line">${t('res.right', { right, total: counted.length })} ${esc(verdict)}</p>
        <dl class="score-facts">
          <div><dt>${esc(t('res.bestRun'))}</dt><dd>${r.bestStreak}</dd></div>
          <div><dt>${esc(t('res.avgTime'))}</dt><dd>${avg ? esc(t('res.secondsShort', { s: avg })) : '–'}</dd></div>
        </dl>
        <p class="save-state ${r.error ? 'is-error' : ''}">
          ${esc(r.error ? t('res.notSaved', { error: r.error }) : r.saved ? t('res.saved') : counted.length ? t('res.saving') : '')}
        </p>
        ${r.error ? `<button class="btn btn-ghost" data-retry>${esc(t('res.retry'))}</button>` : ''}
      </div>

      <div class="results-actions">
        <a class="btn btn-marigold btn-block" href="#/play/${r.cat}" data-again>${esc(t('res.again'))}</a>
        <a class="btn btn-ghost btn-block" href="#/">${esc(t('res.back'))}</a>
      </div>

      <h2 class="section-title">${esc(t('res.yourAnswers'))}</h2>
      <ol class="review">
        ${r.results.map((x, i) => `
          <li class="${x.skipped ? 'is-skipped' : x.correct ? 'is-right' : 'is-wrong'}">
            <span class="review-mark">${x.skipped ? '–' : x.correct ? ICONS.check : ICONS.cross}</span>
            <span class="review-text">
              <strong>${esc(qt(x.q, x.q.answer))}</strong>
              <span>${esc(x.skipped ? t('res.skipped') : x.correct ? t('res.rightLine', { s: (x.ms / 1000).toFixed(1), points: x.points }) : x.choice ? t('res.youSaid', { choice: qt(x.q, x.choice) }) : t('res.timeout'))}</span>
            </span>
            <span class="review-cat">${ICONS[x.q.cat]}</span>
            <button class="review-report" data-report-i="${i}" aria-label="${esc(t('report.button'))}" title="${esc(t('report.button'))}">${ICONS.report}</button>
          </li>`).join('')}
      </ol>
    </section>`;

  app.querySelector('[data-retry]')?.addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = t('res.saving');
    saveRecord(r);
  });

  app.querySelectorAll('[data-report-i]').forEach((btn) => {
    const q = r.results[Number(btn.dataset.reportI)].q;
    if (reportedIds.has(q.id)) return markReported(btn);
    btn.addEventListener('click', async () => {
      if (await openReportSheet(q)) markReported(btn, q);
    });
  });

  // "Play again" goes to the same hash; force a fresh round.
  app.querySelector('[data-again]').addEventListener('click', (e) => {
    e.preventDefault();
    go(`#/play/${r.cat}`);
  });
}

// ── Progress ───────────────────────────────────────────────────

async function showProgress() {
  const user = state.user;
  app.innerHTML = `<section class="screen progress has-tabbar"><header class="topbar"><span class="logo">Smarts</span></header><p class="sub">${esc(t('prog.loading'))}</p></section>${tabbar('progress')}`;
  const nav = navId;
  let s;
  try {
    s = await loadStats(true);
    if (nav !== navId) return;
  } catch (err) {
    if (nav !== navId) return;
    if (err.status === 401) return signOut();
    app.querySelector('.sub').textContent = t('prog.loadFailed', { error: errMsg(err) });
    return;
  }

  const acc = s.answered ? Math.round((s.correct / s.answered) * 100) : 0;
  const byCat = Object.fromEntries(s.byCategory.map((c) => [c.category, c]));
  const maxDay = Math.max(1, ...s.days.map((d) => d.answered));
  const fmtDay = (iso) => fmtDate(new Date(`${iso}T12:00:00`), { day: 'numeric', month: 'short' });

  const empty = !s.answered;
  const secs = (ms) => t('unit.seconds', { s: (ms / 1000).toFixed(1) });
  const duration = (ms) => {
    const m = Math.round(ms / 60000);
    if (m < 1) return t('unit.seconds', { s: Math.round(ms / 1000) });
    if (m < 60) return t('unit.min', { m });
    return t('unit.hmin', { h: Math.floor(m / 60), m: m % 60 });
  };
  const pct = (w) => (w.answered ? Math.round((w.correct / w.answered) * 100) : null);
  const weekNow = pct(s.thisWeek);
  const weekBefore = pct(s.lastWeek);
  const weekChange =
    weekNow === null ? t('week.none')
      : weekBefore === null ? t('week.noCompare')
        : weekNow === weekBefore ? t('week.same')
          : t(weekNow > weekBefore ? 'week.up' : 'week.down', { n: Math.abs(weekNow - weekBefore) });

  // Strongest and weakest topics, once a topic has enough answers to judge.
  const judged = s.byCategory
    .filter((c) => CATEGORY_BY_ID[c.category] && c.answered >= 5)
    .map((c) => ({ ...c, acc: Math.round((c.correct / c.answered) * 100) }))
    .sort((a, b) => b.acc - a.acc);
  const strongest = judged[0];
  const weakest = judged.length > 1 ? judged.at(-1) : null;

  const toReview = s.missed.filter((m) => QUESTION_BY_ID.has(m.id)).slice(0, 6);
  const reviewLabel = (q) => (q.visual.type === 'text' || q.ownPrompt ? qt(q, q.prompt) : CATEGORY_BY_ID[q.cat] ? catName(CATEGORY_BY_ID[q.cat]) : '');
  const topicName = (id) => esc(catName(CATEGORY_BY_ID[id]));

  app.innerHTML = `
    <section class="screen progress has-tabbar">
      <header class="topbar">
        <span class="logo">Smarts</span>
        ${avatar(user)}
      </header>

      <h1 class="greeting">${esc(t('prog.title'))}</h1>

      ${empty ? `
        <div class="panel empty">
          <p>${t('prog.empty')}</p>
          <a class="btn btn-marigold" href="#/play/mixed">${esc(t('prog.playQuick'))}</a>
        </div>` : `
        <div class="panel hero-panel">
          <p class="hero-num">${s.correct}</p>
          <p class="hero-label">${t('prog.heroLabel', { answered: s.answered, acc })}</p>
          <div class="acc-bar" aria-hidden="true"><span style="width:${acc}%"></span></div>
        </div>

        <dl class="facts">
          <div><dt>${esc(t('prog.dayStreak'))}</dt><dd>${s.dayStreak}<small> ${esc(tn('prog.days', s.dayStreak))}</small></dd><p>${esc(t('prog.bestN', { n: s.bestDayStreak }))}</p></div>
          <div><dt>${esc(t('prog.mastered'))}</dt><dd>${s.masteredIds.length}<small>/${QUESTIONS.length}</small></dd><p>${esc(t('prog.ofAll', { p: Math.round((s.masteredIds.length / QUESTIONS.length) * 100) }))}</p></div>
          <div><dt>${esc(t('prog.rounds'))}</dt><dd>${s.rounds}</dd><p>${esc(t('prog.perfect', { n: s.perfectRounds }))}</p></div>
          <div><dt>${esc(t('prog.bestRound'))}</dt><dd>${s.bestScore}</dd><p>${esc(t('prog.average', { n: s.avgScore }))}</p></div>
          <div><dt>${esc(t('prog.inARow'))}</dt><dd>${s.bestStreak}</dd><p>${esc(t('prog.now', { n: s.currentStreak }))}</p></div>
          <div><dt>${esc(t('prog.avgTime'))}</dt><dd>${s.avgCorrectMs ? esc(secs(s.avgCorrectMs)) : '–'}</dd><p>${esc(t('prog.fastest', { t: s.fastestMs ? secs(s.fastestMs) : '–' }))}</p></div>
          <div><dt>${esc(t('prog.timePlayed'))}</dt><dd>${esc(duration(s.totalMs))}</dd><p>${esc(tn('prog.answers', s.answered))}</p></div>
          <div><dt>${esc(t('prog.timeouts'))}</dt><dd>${s.timeouts}</dd><p>${esc(t('prog.ofAnswers', { p: s.answered ? Math.round((s.timeouts / s.answered) * 100) : 0 }))}</p></div>
        </dl>

        <div class="panel">
          <h2 class="panel-title">${esc(t('prog.thisWeek'))}</h2>
          <div class="weeks">
            <div><span class="week-num">${weekNow === null ? '–' : `${weekNow}%`}</span><span>${esc(t('prog.rightThisWeek', { n: s.thisWeek.answered }))}</span></div>
            <div><span class="week-num is-muted">${weekBefore === null ? '–' : `${weekBefore}%`}</span><span>${esc(t('prog.weekBefore', { n: s.lastWeek.answered }))}</span></div>
          </div>
          <p class="week-change">${esc(weekChange)}</p>
        </div>

        ${strongest ? `
          <div class="panel">
            <h2 class="panel-title">${esc(t('prog.extremes'))}</h2>
            <ul class="extremes">
              <li style="--hue:${CATEGORY_BY_ID[strongest.category].hue}"><span class="cat-icon">${ICONS[strongest.category]}</span><span><strong>${topicName(strongest.category)}</strong><span>${esc(t('prog.bestTopic', { p: strongest.acc }))}</span></span></li>
              ${weakest && weakest.category !== strongest.category ? `<li style="--hue:${CATEGORY_BY_ID[weakest.category].hue}"><span class="cat-icon">${ICONS[weakest.category]}</span><span><strong>${topicName(weakest.category)}</strong><span>${esc(t('prog.weakTopic', { p: weakest.acc }))}</span></span></li>` : ''}
            </ul>
          </div>` : ''}

        <div class="panel">
          <h2 class="panel-title">${esc(t('prog.last14'))}</h2>
          <div class="days" role="img" aria-label="${esc(t('prog.daysAria'))}">
            ${s.days.map((d) => `
              <span class="day" title="${esc(t('prog.dayTitle', { date: fmtDay(d.date), right: d.correct, n: d.answered }))}">
                <span class="day-bar" style="height:${(d.answered / maxDay) * 100}%"><span style="height:${d.answered ? (d.correct / d.answered) * 100 : 0}%"></span></span>
              </span>`).join('')}
          </div>
          <div class="days-axis"><span>${esc(fmtDay(s.days[0].date))}</span><span>${esc(t('prog.today'))}</span></div>
          <p class="legend"><span class="sw sw-right"></span>${esc(t('prog.legendRight'))} <span class="sw sw-all"></span>${esc(t('prog.legendAnswered'))}</p>
        </div>`}

      <div class="panel">
        <h2 class="panel-title">${esc(t('prog.byTopic'))}</h2>
        <ul class="cat-stats">
          ${CATEGORIES.map((c) => {
            const x = byCat[c.id] || { answered: 0, correct: 0, mastered: 0 };
            const total = CAT_COUNT[c.id];
            const a = x.answered ? Math.round((x.correct / x.answered) * 100) : null;
            return `
              <li style="--hue:${c.hue}">
                <span class="cat-icon">${ICONS[c.id]}</span>
                <span class="cat-body">
                  <span class="cat-head"><strong>${esc(catName(c))}</strong><span>${esc(t('prog.masteredOf', { m: x.mastered, total }))}</span></span>
                  <span class="meter meter-ink"><span style="width:${(x.mastered / total) * 100}%"></span></span>
                  <span class="cat-acc">${esc(a === null ? t('prog.notPlayed') : tn('prog.catAcc', x.answered, { p: a }) + (x.avgMs ? t('prog.whenRight', { t: secs(x.avgMs) }) : ''))}</span>
                </span>
              </li>`;
          }).join('')}
        </ul>
      </div>

      ${toReview.length ? `
        <div class="panel">
          <h2 class="panel-title">${esc(t('prog.missMost'))}</h2>
          <ul class="review-list">
            ${toReview.map((m) => {
              const q = QUESTION_BY_ID.get(m.id);
              return `
                <li>
                  <span class="cat-icon" style="--hue:${CATEGORY_BY_ID[q.cat]?.hue}">${ICONS[q.cat] || ICONS.mixed}</span>
                  <span class="review-body">
                    <span class="review-q">${esc(reviewLabel(q))}</span>
                    <strong>${esc(qt(q, q.answer))}</strong>
                    <span class="review-count">${esc(tn('prog.missed', m.wrong) + (m.right ? t('prog.rightTimes', { n: m.right }) : ''))}</span>
                  </span>
                </li>`;
            }).join('')}
          </ul>
          <a class="btn btn-marigold btn-block" href="#/play/review">${esc(t('prog.practise'))}</a>
        </div>` : ''}

      ${s.recent.length ? `
        <div class="panel">
          <h2 class="panel-title">${esc(t('prog.recent'))}</h2>
          <ul class="recent">
            ${s.recent.map((r) => `
              <li>
                <span class="recent-icon">${ICONS[r.category] || ICONS.mixed}</span>
                <span class="recent-text"><strong>${esc(roundTitle(r.category))}</strong><span>${esc(t('prog.recentLine', { ago: timeAgo(r.created_at), c: r.correct, t: r.total }))}</span></span>
                <span class="recent-score">${r.score}</span>
              </li>`).join('')}
          </ul>
        </div>` : ''}

      <div class="panel settings">
        <h2 class="panel-title">${esc(t('set.title'))}</h2>
        <label class="setting">
          <span><strong>${esc(t('set.autoNext'))}</strong><span>${esc(t('set.autoNextHint'))}</span></span>
          <input type="checkbox" class="switch" data-setting="autoNext" ${autoNextOn() ? 'checked' : ''}>
        </label>
        <div class="setting setting-range ${autoNextOn() ? '' : 'is-off'}" data-delay-row>
          <label for="auto-delay"><strong>${esc(t('set.wait'))}</strong><span>${esc(t('set.waitHint'))}</span></label>
          <div class="range-row">
            <input type="range" id="auto-delay" min="${AUTO_DELAY.min}" max="${AUTO_DELAY.max}" step="1" value="${autoDelaySeconds()}" ${autoNextOn() ? '' : 'disabled'} aria-describedby="auto-delay-out">
            <output id="auto-delay-out" for="auto-delay">${esc(t('unit.seconds', { s: autoDelaySeconds() }))}</output>
          </div>
        </div>
      </div>

      <div class="account">
        <p>${t('acc.signedInAs', { name: esc(user.name) })}${user.email ? ` <span dir="ltr">(${esc(user.email)})</span>` : user.provider === 'dev' ? ` ${esc(t('acc.localName'))}` : ''}</p>
        <button class="btn btn-ghost" data-signout>${esc(t('acc.signOut'))}</button>
        <div class="account-links">
          ${user.admin ? `<a class="link-btn" href="#/admin">${esc(t('acc.reports'))}</a>` : ''}
          <button class="link-btn" data-signout-all>${esc(t('acc.signOutAll'))}</button>
          <a class="link-btn" href="/api/account/export" download>${esc(t('acc.download'))}</a>
          <button class="link-btn link-danger" data-delete-account>${esc(t('acc.delete'))}</button>
          <a class="link-btn" href="/privacy">${esc(t('common.privacy'))}</a>
        </div>
      </div>
    </section>
    ${tabbar('progress')}`;

  app.querySelector('[data-signout]').addEventListener('click', () => signOut());
  app.querySelector('[data-signout-all]').addEventListener('click', () => signOut({ everywhere: true }));
  app.querySelector('[data-delete-account]').addEventListener('click', (e) => deleteAccount(e.currentTarget));
  const delayRow = app.querySelector('[data-delay-row]');
  const delayInput = app.querySelector('#auto-delay');
  const delayOut = app.querySelector('#auto-delay-out');
  app.querySelector('[data-setting="autoNext"]').addEventListener('change', (e) => {
    setSetting('autoNext', e.target.checked);
    delayInput.disabled = !e.target.checked;
    delayRow.classList.toggle('is-off', !e.target.checked);
  });
  delayInput.addEventListener('input', () => {
    const secs = Math.min(AUTO_DELAY.max, Math.max(AUTO_DELAY.min, Math.round(Number(delayInput.value)) || AUTO_DELAY.fallback));
    delayOut.textContent = t('unit.seconds', { s: secs });
    setSetting('autoNextDelay', secs);
  });
}

// ── Admin: question reports ────────────────────────────────────

const REASON_BY_ID = Object.fromEntries(REPORT_REASONS.map((r) => [r.id, r]));
const STATUS_TABS = ['open', 'fixed', 'dismissed'];

async function showAdmin(status = 'open') {
  if (!STATUS_TABS.includes(status)) status = 'open';
  const nav = navId;
  const tabs = STATUS_TABS.map((s) =>
    `<a class="admin-tab ${s === status ? 'is-active' : ''}" href="#/admin/${s}" ${s === status ? 'aria-current="page"' : ''}>${esc(t(`admin.tab.${s}`))}</a>`).join('');
  const frame = (body) => `
    <section class="screen admin has-tabbar">
      <header class="topbar"><span class="logo">Smarts</span></header>
      <h1 class="section-title">${esc(t('admin.title'))}</h1>
      <nav class="admin-tabs" aria-label="${esc(t('admin.statusAria'))}">${tabs}</nav>
      ${body}
    </section>
    ${tabbar('progress')}`;
  app.innerHTML = frame(`<p class="sub">${esc(t('admin.loading'))}</p>`);

  let reports;
  try {
    ({ reports } = await api(`/api/admin/reports?status=${status}`));
    if (nav !== navId) return;
  } catch (err) {
    if (nav !== navId) return;
    if (err.status === 401) return signOut();
    app.querySelector('.sub').textContent = t('admin.loadFailed', { error: errMsg(err) });
    return;
  }

  // One card per question, most recently reported first.
  const groups = new Map();
  for (const r of reports) {
    if (!groups.has(r.questionId)) groups.set(r.questionId, []);
    groups.get(r.questionId).push(r);
  }

  const card = ([id, list]) => {
    const q = QUESTION_BY_ID.get(id);
    const topic = q && CATEGORY_BY_ID[q.cat];
    const counts = {};
    for (const r of list) counts[r.reason] = (counts[r.reason] || 0) + 1;
    const notes = list.filter((r) => r.note);
    const photo = q?.visual.type === 'wiki'
      ? `<p class="admin-meta">${esc(t('admin.photo'))} <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(q.visual.title.replace(/ /g, '_'))}" target="_blank" rel="noopener" dir="ltr">${esc(q.visual.title)}</a></p>`
      : '';
    // The question itself is shown in English, exactly as stored in shared/questions.js.
    return `
      <article class="panel admin-card" data-qid="${esc(id)}">
        <p class="admin-meta">${topic ? `${ICONS[q.cat] || ''}<span>${esc(catName(topic))}</span> · ` : ''}<code dir="ltr">${esc(id)}</code></p>
        ${q ? `
          <div dir="ltr" lang="en">
            <h2 class="admin-q">${esc(q.prompt)}</h2>
            <p class="admin-answers"><strong>${esc(q.answer)}</strong> · ${q.wrong.map(esc).join(' · ')}</p>
          </div>
          ${photo}` : `<h2 class="admin-q">${esc(t('admin.gone'))}</h2>`}
        <ul class="admin-reasons">
          ${Object.entries(counts).map(([reason, n]) => `<li><b>${n}×</b> ${esc(REASON_BY_ID[reason] ? reasonLabel(REASON_BY_ID[reason]) : reason)}</li>`).join('')}
        </ul>
        ${notes.length ? `<ul class="admin-notes">${notes.map((r) => `<li dir="auto">“${esc(r.note)}” <span>${esc(r.userName || t('admin.deletedAccount'))}, ${esc(timeAgo(r.created_at))}</span></li>`).join('')}</ul>` : ''}
        ${status === 'open'
          ? `<div class="admin-actions">
               <button class="btn btn-ghost-ink" data-resolve="dismissed">${esc(t('admin.dismiss'))}</button>
               <button class="btn btn-marigold" data-resolve="fixed">${esc(t('admin.markFixed'))}</button>
             </div>`
          : `<p class="admin-meta">${esc(t(status === 'fixed' ? 'admin.fixedAgo' : 'admin.dismissedAgo', { ago: timeAgo(list[0].resolved_at) }))}</p>`}
      </article>`;
  };

  app.innerHTML = frame(groups.size
    ? `<p class="sub">${esc(tn('admin.count', groups.size))} ${t('admin.hint')}</p>${[...groups].map(card).join('')}`
    : `<p class="sub">${esc(t(`admin.none.${status}`))}</p>`);

  app.querySelectorAll('[data-resolve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cardEl = btn.closest('[data-qid]');
      cardEl.querySelectorAll('[data-resolve]').forEach((b) => (b.disabled = true));
      try {
        await api('/api/admin/reports/resolve', { method: 'POST', body: { questionId: cardEl.dataset.qid, status: btn.dataset.resolve } });
        cardEl.remove();
        if (!app.querySelector('[data-qid]')) showAdmin(status);
      } catch (err) {
        cardEl.querySelectorAll('[data-resolve]').forEach((b) => (b.disabled = false));
        window.alert(t('admin.updateFailed', { error: errMsg(err) }));
      }
    });
  });
}

boot();
