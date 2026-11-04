import { QUESTIONS, QUESTION_BY_ID } from '/shared/questions.js';
import {
  MODES, DEFAULT_MODE, CATEGORIES, CATEGORY_BY_ID, AUTO_DELAY, REPORT_REASONS, REPORT_NOTE_MAX, MAX_POINTS, pointsFor, secondsFor, localDate,
} from '/shared/config.js';
import { avatarUrl, avatarCode, parseAvatar, randomAvatar, ANIMALS, EYES, BACKGROUNDS, EXTRAS } from '/shared/avatars.js';
import { COUNTRIES } from '/shared/countries.js';
import { squareFor, copyText, shareText, shareImage, resultImage } from './share.js';
import { render as renderVisual, preload, isPreloaded, fetchNow, missingHtml, loadLocalImages } from './visuals.js';
import { signSvg } from './signs.js';
import { ICONS } from './icons.js';
import { api, esc, shuffle, reduceMotion } from './util.js';
import {
  LANGUAGES, lang, setLang, savedLang, rememberLang, deviceLang, isLang, locale, t, tn, qt, catName, catBlurb, reasonLabel, timeAgo, fmtDate,
} from './i18n.js';

const app = document.getElementById('app');
const state = {
  config: null, user: null, settings: null, profile: null, stats: null, lastRound: null,
  daily: null, // today's Daily and the player's result, for the home screen
  fixedRound: null, // a Daily or duel about to be played
  duelFriend: null, // the friend a new duel is for
  unsaved: null, // a Daily or duel result that failed to save
};
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
    state.profile = me.profile;
    adoptSettings(me.settings);
    await adoptLanguage(me.settings);
  } catch (err) {
    // 503: the server is full (too many players at once); anything else: it's unreachable.
    await setLang(firstLang).catch(() => {});
    const msg = err.status === 503 ? t('app.full') : t('app.unreachable');
    app.innerHTML = `<section class="screen center-screen"><p class="error-text">${esc(msg)}</p></section>`;
    return;
  }
  takeSharedLink();
  window.addEventListener('hashchange', route);
  route();
  // Makes Smarts installable on phones and lets it open without a connection (public/sw.js).
  navigator.serviceWorker?.register('/sw.js').catch(() => {});
}

/**
 * Shared links are plain addresses (/duel/AB12CD34, /f/CODE12, /daily) so their previews look
 * right in chat apps. The app itself uses # addresses, so turn them into one.
 */
function takeSharedLink() {
  const path = location.pathname;
  let m;
  let hash = null;
  if ((m = /^\/duel\/([A-Z2-9]{8})\/?$/.exec(path))) {
    hash = `#/duel/${m[1]}`;
    // Someone who opens a duel link and signs in goes straight into the game.
    try { sessionStorage.setItem('smarts:autoplay', m[1]); } catch { /* storage blocked */ }
  } else if ((m = /^\/f\/([A-Za-z2-9]{6})\/?$/.exec(path))) hash = `#/add/${m[1].toUpperCase()}`;
  else if (/^\/daily\/?$/.test(path)) hash = '#/daily';
  if (hash) history.replaceState(null, '', `/${hash}`);
}

/** A server error as a message in the current language. */
function errMsg(err) {
  if (err.status === 429) return t('err.rateLimited', { s: err.retryAfter || 60 });
  if (err.status === 503) return t('app.full');
  if (err.status === 401) return t('err.signedOut');
  if (!err.status) return t('err.network');
  return lang() === 'en' ? err.message : t('err.generic'); // the server's own messages are in English
}

/**
 * Logs an event for the admin Players page (only events marked `client` in EVENTS in
 * shared/config.js). Fire and forget: it never holds up or breaks the game.
 */
function track(name, props = null) {
  if (!state.user) return;
  fetch('/api/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, props }),
    keepalive: true, credentials: 'same-origin',
  }).catch(() => {});
}

/** Links to the privacy policy, terms of use and photo credits, in the current language. */
const legalLinks = (cls = '') =>
  ['privacy', 'terms', 'credits'].map((p) => `<a${cls ? ` class="${cls}"` : ''} href="/${p}?lang=${lang()}">${esc(t(`common.${p}`))}</a>`).join('');

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
  if (page === 'play' && (arg === 'daily' || arg === 'duel')) {
    const fixed = state.fixedRound;
    state.fixedRound = null;
    return fixed?.kind === arg ? startRound(arg, fixed) : go('#/', { replace: true });
  }
  if (page === 'play' && (arg === 'mixed' || arg === 'review' || CATEGORY_BY_ID[arg])) return startRound(arg);
  if (page === 'daily') return showDaily();
  if (page === 'duel' && arg === 'new') return showDuelNew();
  if (page === 'duel' && arg) return showDuel(arg);
  if (page === 'friends') return showFriends();
  if (page === 'add' && arg) return showAddFriend(arg);
  if (page === 'profile') return showProfile();
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
      <div class="link-banner" data-link-banner hidden></div>
      <div class="signin-head">
        <h1 class="logo logo-xl">Smarts</h1>
        <div class="demo-card" aria-hidden="true">
          <div class="demo-fuse"><span></span></div>
          <div class="demo-pic">${signSvg('give-way')}</div>
          <ul class="demo-options">
            ${demoOptions.map((o) => `<li class="${o === 'Give way' ? 'is-correct' : ''}">${esc(qt(sign, o))}</li>`).join('')}
          </ul>
        </div>
        <p class="lede">${esc(t('signin.lede', { count: QUESTIONS.length, topics: CATEGORIES.length, secs: MODES[DEFAULT_MODE].secondsPerQuestion }))}</p>
      </div>
      <div class="signin-actions">
        ${googleClientId ? `
          <div class="signin-card">
            <h2>${esc(t('signin.title'))}</h2>
            <p>${esc(t('signin.why'))}</p>
            <div id="google-btn" class="google-btn"></div>
          </div>` : ''}
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
        <p class="signin-legal">${legalLinks()}</p>
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
  showLinkBanner();

  app.querySelector('.dev-login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name');
    try {
      const { user, settings, profile } = await api('/api/auth/dev', { method: 'POST', body: { name } });
      await signedIn(user, settings, null, profile);
    } catch (err) {
      showError(errMsg(err));
    }
  });
}

/** On the sign-in screen, says who sent the duel or invite link the player arrived from. */
async function showLinkBanner() {
  const banner = app.querySelector('[data-link-banner]');
  const [, page, arg] = (location.hash || '').split('/');
  let html = null;
  try {
    if (page === 'duel' && arg) {
      const p = await api(`/api/duels/${encodeURIComponent(arg)}/preview`);
      html = `${avatarImg(p.challenger?.avatar, 56)}<span><strong>${t('duel.challengedYou', { name: personName(p.challenger) })}</strong><span>${esc(t('link.signInToPlay'))}</span></span>`;
    } else if (page === 'add' && arg) {
      const { inviter } = await api(`/api/invite/${encodeURIComponent(arg)}`);
      html = `${avatarImg(inviter.avatar, 56)}<span><strong>${t('link.invited', { name: personName(inviter) })}</strong><span>${esc(t('link.signInToAdd'))}</span></span>`;
    } else if (page === 'daily') {
      html = `<span class="daily-badge">${ICONS.daily}</span><span><strong>${esc(t('link.daily'))}</strong><span>${esc(t('link.signInToPlay'))}</span></span>`;
    }
  } catch { /* an old or broken link: no banner */ }
  if (!html || !banner?.isConnected) return;
  banner.innerHTML = html;
  banner.hidden = false;
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
          const { user, settings, profile, locale: googleLocale } = await api('/api/auth/google', { method: 'POST', body: { credential } });
          await signedIn(user, settings, googleLocale, profile);
        } catch (err) {
          showError(errMsg(err));
        }
      },
    });
    const el = document.getElementById('google-btn');
    if (!el) return;
    google.accounts.id.renderButton(el, {
      theme: 'filled_blue', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'center',
      width: Math.min(400, Math.max(240, el.clientWidth)), // 400 is the widest Google allows
      locale: lang(), // the button's own text in the chosen language
    });
    el.classList.add('is-ready');
    // Also offer Google's own "Continue as …" prompt, so a signed-in Google user needs one tap.
    google.accounts.id.prompt();
  } catch (err) {
    showError(err.message);
  }
}

async function signedIn(user, settings, googleLocale = null, profile = null) {
  state.user = user;
  state.profile = profile;
  adoptSettings(settings);
  await adoptLanguage(settings, googleLocale);
  state.stats = null;
  // Arrived from a shared link (a duel, an invite, the Daily): carry on there.
  go(/^#\/(duel|add|daily)/.test(location.hash) ? location.hash : '#/');
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
  state.profile = null;
  state.stats = null;
  state.daily = null;
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

/** The signed-in player's own avatar (or any avatar code). */
const avatar = (code = state.profile?.avatar, size = 36) => avatarImg(code, size);

function tabbar(active) {
  return `
    <nav class="tabbar" aria-label="Main">
      <a href="#/" class="${active === 'home' ? 'is-active' : ''}" ${active === 'home' ? 'aria-current="page"' : ''}>${ICONS.play}<span>${esc(t('tab.play'))}</span></a>
      <a href="#/friends" class="${active === 'friends' ? 'is-active' : ''}" ${active === 'friends' ? 'aria-current="page"' : ''}>${ICONS.friends}<span>${esc(t('tab.friends'))}</span></a>
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

/** The Daily Challenge card at the top of the home screen. */
function dailyCard(d) {
  const played = d?.result?.finished;
  const n = d?.number;
  return `
    <a class="daily-card ${played ? 'is-played' : ''}" href="#/daily">
      <span class="daily-badge">${ICONS.daily}</span>
      <span class="quick-text">
        <strong>${esc(n ? t('daily.title', { n }) : t('daily.titlePlain'))}</strong>
        <span>${esc(played ? t('daily.youScored', { score: d.result.score, max: d.questionIds.length * MAX_POINTS }) : t('daily.desc'))}</span>
      </span>
      <span class="daily-go">${esc(played ? t('daily.seeBoard') : t('daily.play'))}</span>
    </a>`;
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
            <a href="#/progress" class="avatar-link" aria-label="${esc(t('home.yourProgress'))}">${avatar()}</a>
          </span>
        </header>

        <h1 class="greeting">${esc(t('home.hi', { name: firstName }))}</h1>
        <p class="sub">${stats ? esc(t('home.sub', { n: totalMastered, total: QUESTIONS.length })) : '&nbsp;'}</p>

        ${dailyCard(state.daily)}

        <a class="quick ${hint ? 'is-hinting' : ''}" href="#/play/mixed">
          ${hint ? `<span class="quick-hint" aria-hidden="true">${esc(t('quick.hint'))}</span>` : ''}
          <span class="quick-text">
            <strong>${esc(t('quick.title'))}</strong>
            <span>${esc(t('quick.desc', { n: MODES[DEFAULT_MODE].questionsPerRound }))}</span>
          </span>
          <span class="quick-go" aria-hidden="true"><span>${esc(t('quick.play'))}</span>${ICONS.play}</span>
        </a>

        <a class="duel-card" href="#/duel/new">
          <span class="duel-card-icon">${ICONS.duel}</span>
          <span class="quick-text"><strong>${esc(t('duel.cardTitle'))}</strong><span>${esc(t('duel.cardDesc'))}</span></span>
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
    const [stats] = await Promise.all([loadStats(), state.daily?.day === today() ? null : loadDaily().catch(() => null)]);
    if (nav === navId) draw(stats);
  } catch (err) {
    if (err.status === 401) return signOut();
  }
}

// ── Round ──────────────────────────────────────────────────────

const roundTitle = (cat) =>
  cat === 'mixed' ? t('round.quick') : cat === 'review' ? t('round.review') : cat === 'daily' ? t('round.daily') : cat === 'duel' ? t('round.duel')
    : CATEGORY_BY_ID[cat] ? catName(CATEGORY_BY_ID[cat]) : cat;

const diffLevel = (d) => (d <= 3 ? 'easy' : d <= 6 ? 'medium' : 'hard');
/** "Hard · 8": how hard a question is, 0 to 10. */
const diffChip = (q) => (q.difficulty === undefined ? '' : `<span class="diff diff-${diffLevel(q.difficulty)}" title="${esc(t('diff.title'))}">${esc(t(`diff.${diffLevel(q.difficulty)}`))} · ${q.difficulty}</span>`);

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

/**
 * Plays a round. `fixed` plays set questions instead of picking them (the Daily, a duel):
 * { kind, questions, title, after: where to go when done, endpoint and extra: where to send the answers }.
 */
async function startRound(cat, fixed = null) {
  const nav = navId;
  const mode = DEFAULT_MODE;
  const cfg = MODES[mode];
  let stats = state.stats;
  // Review and Quick rounds depend on what you just played, so they always use fresh stats.
  const needFresh = !fixed && (cat === 'review' || cat === 'mixed');
  if (!fixed && (!stats || needFresh)) stats = await loadStats(needFresh).catch(() => stats);
  if (nav !== navId) return; // the player went somewhere else while stats loaded

  const round = {
    cat, mode, cfg, fixed,
    questions: fixed ? [...fixed.questions] : pickQuestions(cat, cfg.questionsPerRound, stats),
    idx: 0,
    results: [], // { q, choice, correct, ms, points, skipped }
    score: 0,
    streak: 0,
    bestStreak: 0,
    saved: false, // set once answers have been sent to the server
    swaps: 0, // questions replaced because their picture wouldn't load
  };
  if (!round.questions.length) return go('#/', { replace: true });
  if (!fixed) track('round_started', { mode, category: cat }); // the Daily and duels log theirs when the try starts

  const title = fixed?.title ?? roundTitle(cat);
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
    // (Not in the Daily or a duel: everyone there plays the same questions, so it's just skipped.)
    if (!ok && !round.fixed && round.swaps < MAX_SWAPS) {
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
    if (round.fixed) {
      const saving = saveFixed(record); // started first, so the next screen can wait for it
      leave(round.fixed.after);
      return saving;
    }
    state.lastRound = record;
    leave('#/results');
    await saveRecord(record);
  }

  function savePartial({ beacon = false } = {}) {
    if (round.saved) return;
    round.saved = true;
    rememberPlayed();
    // A Daily or duel that's left counts as played, with the answers given so far.
    if (round.fixed) {
      saveFixed({ ...round, payload: answersPayload(round.results) }, { partial: true, beacon });
      return;
    }
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
    $('[data-quit-note]').textContent = round.fixed
      ? t(round.fixed.kind === 'daily' ? 'quit.daily' : 'quit.duel')
      : done ? tn('quit.noteSome', done) : t('quit.noteNone');
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
    leave(round.fixed?.after ?? '#/');
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
              ${diffChip(x.q)}
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

// ── People: avatars, flags, names ──────────────────────────────

/** A player's avatar picture (their animal; hidden players get a plain silhouette). */
const avatarImg = (code, size = 40, cls = '') =>
  `<img class="avatar ${cls}" src="${avatarUrl(code)}" alt="" width="${size}" height="${size}">`;

function countryName(cc) {
  try {
    return new Intl.DisplayNames([locale()], { type: 'region' }).of(cc);
  } catch {
    return cc;
  }
}

const flagImg = (cc) => (cc
  ? `<img class="flag" src="https://flagcdn.com/w40/${esc(cc.toLowerCase())}.png" alt="${esc(countryName(cc))}" title="${esc(countryName(cc))}" width="20" height="15" loading="lazy">`
  : '');

/** Name and flag; a hidden player on a public board shows as "Hidden player". */
const personName = (p) => (p?.hidden || !p?.name
  ? `<span class="is-hidden">${esc(t(p?.gone ? 'people.gone' : 'people.hidden'))}</span>`
  : `<span class="name"><bdi>${esc(p.name)}</bdi>${flagImg(p.country)}</span>`);

const pointsOf = (a) => pointsFor(a.correct, a.ms, secondsFor(QUESTION_BY_ID.get(a.id) || { cat: '' }));

/** One square per question of a fixed round, in the order they were played. */
function squaresFor(questionIds, answers = []) {
  const byId = new Map(answers.map((a) => [a.id, a]));
  return questionIds.map((id) => squareFor(byId.has(id) ? pointsOf(byId.get(id)) : null));
}

const SQUARE_CLASS = { '🟩': 'is-fast', '🟨': 'is-right', '🟥': 'is-wrong', '⬜': 'is-none' };
const squaresHtml = (squares) =>
  `<span class="squares" aria-hidden="true">${squares.map((s) => `<span class="sq ${SQUARE_CLASS[s]}"></span>`).join('')}</span>`;

const topbar = () => `
  <header class="topbar">
    <span class="logo">Smarts</span>
    <a href="#/progress" class="avatar-link" aria-label="${esc(t('home.yourProgress'))}">${avatar()}</a>
  </header>`;

/** A note under share buttons: "Copied", "Saved"… */
function shareStatus(el, result) {
  const key = { copied: 'share.copied', saved: 'share.saved', failed: 'share.failed' }[result];
  el.textContent = key ? t(key) : '';
}

// ── Fixed rounds (the Daily and duels) ─────────────────────────

let pendingSave = Promise.resolve(); // a Daily or duel result still on its way to the server

/** Plays set questions: { kind: 'daily'|'duel', questions, title, after, endpoint, extra }. */
function playFixed(fixed) {
  state.fixedRound = fixed;
  go(`#/play/${fixed.kind}`);
}

/** Sends a fixed round's answers. A failed save is kept so the next screen can offer a retry. */
function saveFixed(record, { partial = false, beacon = false } = {}) {
  const body = { ...record.fixed.extra, answers: record.payload, partial };
  state.stats = null;
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon(record.fixed.endpoint, new Blob([JSON.stringify(body)], { type: 'application/json' }));
    return Promise.resolve();
  }
  state.unsaved = null;
  pendingSave = api(record.fixed.endpoint, { method: 'POST', body })
    .catch((err) => {
      if (err.status !== 409) state.unsaved = { record, partial, error: errMsg(err) }; // 409: already saved
    });
  return pendingSave;
}

/** "Your answers weren't saved" with a retry button, when the last fixed round failed to save. */
function unsavedNote(endpoint) {
  const u = state.unsaved;
  if (!u || u.record.fixed.endpoint !== endpoint) return '';
  return `<div class="panel unsaved"><p>${esc(t('fixed.notSaved', { error: u.error }))}</p><button class="btn btn-marigold btn-block" data-retry-save>${esc(t('res.retry'))}</button></div>`;
}

function bindRetry(after) {
  app.querySelector('[data-retry-save]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const { record, partial } = state.unsaved;
    await saveFixed(record, { partial });
    after();
  });
}

// ── Daily Challenge ────────────────────────────────────────────

const today = () => localDate(new Date().getTimezoneOffset());

async function loadDaily() {
  state.daily = await api(`/api/daily?date=${today()}`);
  return state.daily;
}

/** Time until the next Daily (the player's midnight), as "5h 12m". */
function untilTomorrow() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.max(1, Math.round((midnight - now) / 60000));
  return t('unit.hmin', { h: Math.floor(mins / 60), m: mins % 60 });
}

async function showDaily() {
  const nav = navId;
  app.innerHTML = `<section class="screen daily has-tabbar">${topbar()}<p class="sub">${esc(t('daily.loading'))}</p></section>${tabbar('home')}`;
  let d;
  let board = null;
  try {
    await pendingSave;
    d = await loadDaily();
    if (d.result) board = (await api(`/api/daily/board?date=${d.day}`)).board;
    if (nav !== navId) return;
  } catch (err) {
    if (nav !== navId) return;
    if (err.status === 401) return signOut();
    app.querySelector('.sub').textContent = t('daily.loadFailed', { error: errMsg(err) });
    return;
  }
  if (!d.result) return drawDailyIntro(d);
  drawDailyResult(d, board);
}

function drawDailyIntro(d) {
  app.innerHTML = `
    <section class="screen daily has-tabbar">
      ${topbar()}
      <div class="daily-hero">
        <span class="daily-badge">${ICONS.daily}</span>
        <p class="eyebrow">${esc(fmtDate(new Date(`${d.day}T12:00:00`), { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
        <h1 class="greeting">${esc(t('daily.title', { n: d.number }))}</h1>
        <p class="sub">${esc(t('daily.intro'))}</p>
      </div>
      <ul class="rules">
        <li>${ICONS.check}<span>${esc(t('daily.rule1'))}</span></li>
        <li>${ICONS.clock}<span>${esc(t('daily.rule2', { max: MAX_POINTS }))}</span></li>
        <li>${ICONS.trophy}<span>${esc(t('daily.rule3'))}</span></li>
      </ul>
      <button class="btn btn-marigold btn-block" data-start>${esc(t('daily.start'))}</button>
    </section>
    ${tabbar('home')}`;
  app.querySelector('[data-start]').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api('/api/daily/start', { method: 'POST', body: { date: d.day } });
      if (!r.started) return showDaily(); // already played on another device
      track('round_started', { mode: DEFAULT_MODE, category: 'daily' });
      playFixed({
        kind: 'daily', title: t('daily.title', { n: d.number }), after: '#/daily',
        questions: d.questionIds.map((id) => QUESTION_BY_ID.get(id)).filter(Boolean),
        endpoint: '/api/daily/finish', extra: { date: d.day },
      });
    } catch (err) {
      e.currentTarget.disabled = false;
      window.alert(errMsg(err));
    }
  });
}

function boardList(entries, emptyHtml) {
  if (!entries.length) return `<p class="board-empty">${emptyHtml}</p>`;
  return `<ol class="board">${entries.map((e) => `
    <li class="${e.me ? 'is-me' : ''}">
      <span class="board-rank">${e.rank}</span>
      ${avatarImg(e.avatar, 40)}
      <span class="board-who">${personName(e)}<small>${esc(t('board.right', { c: e.correct, t: e.total }))}</small></span>
      <span class="board-pts">${e.score}</span>
    </li>`).join('')}</ol>`;
}

let boardTab = 'all';

function drawDailyResult(d, board) {
  const r = d.result;
  const finished = !!r.finished;
  const max = d.questionIds.length * MAX_POINTS;
  const squares = squaresFor(d.questionIds, r.answers || []);
  const me = board?.me;
  const answered = new Map((r.answers || []).map((a) => [a.id, a]));
  app.innerHTML = `
    <section class="screen daily has-tabbar">
      ${topbar()}
      <p class="eyebrow on-cobalt">${esc(t('daily.title', { n: d.number }))}</p>
      ${unsavedNote('/api/daily/finish')}
      ${finished ? `
        <div class="panel result-card">
          ${avatar(state.profile?.avatar, 64)}
          <p class="result-score">${r.score}<small>/${max}</small></p>
          <p class="result-line">${esc(t('daily.rightOf', { right: r.correct ?? 0, total: d.questionIds.length }))}${me ? ` · ${esc(t('daily.rank', { rank: me.rank, players: board.players }))}` : ''}</p>
          ${squaresHtml(squares)}
          <div class="share-row">
            <button class="btn btn-marigold" data-share>${ICONS.share}<span>${esc(t('share.share'))}</span></button>
            <button class="btn btn-ghost-ink" data-copy>${ICONS.copy}<span>${esc(t('share.copy'))}</span></button>
            <button class="btn btn-ghost-ink" data-story>${ICONS.image}<span>${esc(t('share.image'))}</span></button>
          </div>
          <p class="share-status" data-share-status aria-live="polite"></p>
        </div>` : `
        <div class="panel"><p>${esc(t('daily.unfinished'))}</p></div>`}
      <p class="next-daily">${esc(t('daily.next', { time: untilTomorrow() }))}</p>

      <div class="panel">
        <div class="seg" role="tablist" aria-label="${esc(t('board.aria'))}">
          <button role="tab" data-tab="all" aria-selected="${boardTab === 'all'}">${esc(t('board.today', { n: board?.players ?? 0 }))}</button>
          <button role="tab" data-tab="friends" aria-selected="${boardTab === 'friends'}">${esc(t('board.friends'))}</button>
        </div>
        <div data-board-all ${boardTab === 'all' ? '' : 'hidden'}>${boardList(board?.top || [], esc(t('board.noneYet')))}
          ${me && !board.top.some((e) => e.me) ? `<p class="board-gap">…</p>${boardList([me], '')}` : ''}</div>
        <div data-board-friends ${boardTab === 'friends' ? '' : 'hidden'}>${boardList(board?.friends || [], `${esc(t('board.noFriends'))} <a href="#/friends">${esc(t('board.invite'))}</a>`)}</div>
      </div>

      ${finished ? `
        <h2 class="section-title">${esc(t('res.yourAnswers'))}</h2>
        <ol class="review">
          ${d.questionIds.map((id) => QUESTION_BY_ID.get(id)).filter(Boolean).map((q) => {
            const a = answered.get(q.id);
            const pts = a ? pointsOf(a) : null;
            return `
              <li class="${!a ? 'is-skipped' : a.correct ? 'is-right' : 'is-wrong'}">
                <span class="review-mark">${!a ? '–' : a.correct ? ICONS.check : ICONS.cross}</span>
                <span class="review-text">
                  <strong>${esc(qt(q, q.answer))}</strong>
                  <span>${esc(!a ? t('res.skipped') : a.correct ? t('res.rightLine', { s: (a.ms / 1000).toFixed(1), points: pts }) : a.choice ? t('res.youSaid', { choice: qt(q, a.choice) }) : t('res.timeout'))}</span>
                  ${diffChip(q)}
                </span>
                <span class="review-cat">${ICONS[q.cat] || ''}</span>
              </li>`;
          }).join('')}
        </ol>` : ''}
    </section>
    ${tabbar('home')}`;

  bindRetry(showDaily);
  app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    boardTab = b.dataset.tab;
    app.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    app.querySelector('[data-board-all]').hidden = boardTab !== 'all';
    app.querySelector('[data-board-friends]').hidden = boardTab !== 'friends';
  }));
  if (!finished) return;

  const status = app.querySelector('[data-share-status]');
  const url = `${location.origin}/daily?l=${lang()}`;
  const text = `${t('daily.shareText', { n: d.number, score: r.score, max, right: r.correct ?? 0, total: d.questionIds.length })}\n${squares.join('')}`;
  app.querySelector('[data-share]').addEventListener('click', async () => shareStatus(status, await shareText({ text, url })));
  app.querySelector('[data-copy]').addEventListener('click', async () => shareStatus(status, (await copyText(`${text}\n${url}`)) ? 'copied' : 'failed'));
  app.querySelector('[data-story]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const blob = await resultImage({
        heading: t('daily.title', { n: d.number }), score: r.score, max, squares, name: state.profile.name, avatar: state.profile.avatar,
        lines: [t('daily.rightOf', { right: r.correct ?? 0, total: d.questionIds.length }), me ? t('daily.rank', { rank: me.rank, players: board.players }) : ''].filter(Boolean),
        footer: t('share.beatMe'), link: url.replace(/^https?:\/\//, '').replace(/\?.*$/, ''),
      });
      shareStatus(status, await shareImage(blob, { name: `smarts-daily-${d.number}.png`, text: `${text}\n${url}` }));
    } finally {
      btn.disabled = false;
    }
  });
}

// ── Duels ──────────────────────────────────────────────────────

/** Starts a new duel on `category` (optionally sent to a friend) and plays the first side. */
async function startDuel(category, friendId = null) {
  const { duel } = await api('/api/duels', { method: 'POST', body: { category, friendId } });
  return playDuel(duel.id);
}

async function playDuel(id) {
  const { duel } = await api(`/api/duels/${id}/start`, { method: 'POST' });
  track('round_started', { mode: DEFAULT_MODE, category: 'duel' });
  playFixed({
    kind: 'duel', title: t('duel.title'), after: `#/duel/${id}`,
    questions: duel.questionIds.map((q) => QUESTION_BY_ID.get(q)).filter(Boolean),
    endpoint: `/api/duels/${id}/finish`, extra: {},
  });
}

const duelTopic = (category) => (category === 'mixed' ? t('duel.mixed') : CATEGORY_BY_ID[category] ? catName(CATEGORY_BY_ID[category]) : category);

/** The other player in a duel, from the viewer's side. */
const duelOther = (d) => (d.role === 'challenger' ? d.opponent || d.invitedFriend : d.challenger);

/** Pick the questions for a new duel: a mix, or one topic. */
function showDuelNew() {
  const friend = state.duelFriend;
  app.innerHTML = `
    <section class="screen duel-new has-tabbar">
      ${topbar()}
      <h1 class="greeting">${esc(t('duel.newTitle'))}</h1>
      <p class="sub">${friend ? t('duel.newFor', { name: `<bdi>${esc(friend.name)}</bdi>` }) : esc(t('duel.newSub'))}</p>
      <button class="quick" data-cat="mixed">
        <span class="quick-text"><strong>${esc(t('duel.mixed'))}</strong><span>${esc(t('duel.mixedDesc'))}</span></span>
        <span class="quick-go" aria-hidden="true">${ICONS.duel}</span>
      </button>
      <h2 class="section-title">${esc(t('duel.orTopic'))}</h2>
      <ul class="topics">
        ${CATEGORIES.map((c) => `
          <li><button class="topic" data-cat="${c.id}" style="--hue:${c.hue}">
            <span class="topic-icon">${ICONS[c.id]}</span>
            <span class="topic-text"><strong>${esc(catName(c))}</strong><span>${esc(catBlurb(c))}</span></span>
          </button></li>`).join('')}
      </ul>
    </section>
    ${tabbar('friends')}`;
  app.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', async () => {
    app.querySelectorAll('[data-cat]').forEach((x) => (x.disabled = true));
    try {
      await startDuel(b.dataset.cat, friend?.id ?? null);
      state.duelFriend = null;
    } catch (err) {
      app.querySelectorAll('[data-cat]').forEach((x) => (x.disabled = false));
      window.alert(errMsg(err));
    }
  }));
}

async function showDuel(id) {
  const nav = navId;
  app.innerHTML = `<section class="screen duel has-tabbar">${topbar()}<p class="sub">${esc(t('duel.loading'))}</p></section>${tabbar('friends')}`;
  let duel;
  try {
    await pendingSave;
    ({ duel } = await api(`/api/duels/${encodeURIComponent(id)}`));
    if (nav !== navId) return;
  } catch (err) {
    if (nav !== navId) return;
    if (err.status === 401) return signOut();
    app.querySelector('.sub').textContent = errMsg(err);
    return;
  }

  // Arrived from a duel link and just signed in: straight into the game.
  let autoplay = null;
  try { autoplay = sessionStorage.getItem('smarts:autoplay'); sessionStorage.removeItem('smarts:autoplay'); } catch { /* storage blocked */ }
  if (autoplay === id && (duel.status === 'open' || duel.status === 'invited')) return playDuel(id).catch((err) => window.alert(errMsg(err)));

  const max = duel.questionIds.length * MAX_POINTS;
  const other = duelOther(duel);
  const myShareUrl = `${location.origin}/duel/${duel.id}?l=${lang()}`;
  let body;
  if (duel.status === 'open' || duel.status === 'invited') {
    const c = duel.challenger;
    body = `
      <div class="panel challenge-card">
        ${avatarImg(c.avatar, 112, 'avatar-xl')}
        <h1 class="challenge-title">${t('duel.challengedYou', { name: personName(c) })}</h1>
        <p class="challenge-sub">${esc(c.score === null ? t('duel.notPlayedYet', { topic: duelTopic(duel.category) }) : t('duel.theyScored', { score: c.score, max, topic: duelTopic(duel.category) }))}</p>
        <button class="btn btn-marigold btn-block" data-play>${esc(t('duel.playNow'))}</button>
      </div>`;
  } else if (duel.status === 'taken') {
    body = `
      <div class="panel challenge-card">
        ${avatarImg(duel.challenger.avatar, 96, 'avatar-xl')}
        <p>${esc(t('duel.taken'))}</p>
        <a class="btn btn-marigold btn-block" href="#/duel/new">${esc(t('duel.startOwn'))}</a>
      </div>`;
  } else if (duel.status === 'yourTurn') {
    body = `
      <div class="panel challenge-card">
        ${other ? avatarImg(other.avatar, 112, 'avatar-xl') : avatar(state.profile?.avatar, 112)}
        <h1 class="challenge-title">${esc(t('duel.yourTurn'))}</h1>
        <p class="challenge-sub">${esc(duelTopic(duel.category))}</p>
        <button class="btn btn-marigold btn-block" data-play>${esc(t('duel.play'))}</button>
      </div>`;
  } else if (duel.status === 'waiting') {
    const mine = duel[duel.role];
    body = `
      <div class="panel challenge-card">
        ${avatar(state.profile?.avatar, 80)}
        <p class="result-score">${mine.score}<small>/${max}</small></p>
        <p class="result-line">${esc(t('daily.rightOf', { right: mine.correct ?? 0, total: duel.questionIds.length }))}</p>
        ${other?.name
          ? `<p class="challenge-sub">${t('duel.waitingFor', { name: personName(other) })}</p>`
          : `<p class="challenge-sub">${esc(t('duel.sendLink'))}</p>`}
        <div class="share-row">
          <button class="btn btn-marigold" data-share>${ICONS.share}<span>${esc(t('duel.sendButton'))}</span></button>
          <button class="btn btn-ghost-ink" data-copy>${ICONS.copy}<span>${esc(t('share.copyLink'))}</span></button>
        </div>
        <p class="share-status" data-share-status aria-live="polite"></p>
      </div>`;
  } else {
    body = duelResultHtml(duel, max);
  }

  app.innerHTML = `
    <section class="screen duel has-tabbar">
      ${topbar()}
      <p class="eyebrow on-cobalt">${esc(t('duel.title'))} · ${esc(duelTopic(duel.category))}</p>
      ${unsavedNote(`/api/duels/${duel.id}/finish`)}
      ${body}
    </section>
    ${tabbar('friends')}`;

  bindRetry(() => showDuel(id));
  app.querySelector('[data-play]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await playDuel(duel.id);
    } catch (err) {
      if (err.status === 409) return showDuel(id);
      e.currentTarget.disabled = false;
      window.alert(errMsg(err));
    }
  });
  const status = app.querySelector('[data-share-status]');
  const mine = duel.role && duel[duel.role];
  const shareMsg = duel.status === 'done'
    ? t('duel.shareResult', { me: mine.score, them: duel[duel.role === 'challenger' ? 'opponent' : 'challenger'].score, max, name: other?.name || '' })
    : t('duel.shareInvite', { score: mine?.score ?? 0, max });
  app.querySelector('[data-share]')?.addEventListener('click', async () => shareStatus(status, await shareText({ text: shareMsg, url: myShareUrl })));
  app.querySelector('[data-copy]')?.addEventListener('click', async () => shareStatus(status, (await copyText(myShareUrl)) ? 'copied' : 'failed'));
  app.querySelector('[data-rematch]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const { duel: next } = await api(`/api/duels/${duel.id}/rematch`, { method: 'POST' });
      await playDuel(next.id);
    } catch (err) {
      e.currentTarget.disabled = false;
      window.alert(errMsg(err));
    }
  });
}

function duelResultHtml(duel, max) {
  const meSide = duel.role;
  const themSide = meSide === 'challenger' ? 'opponent' : 'challenger';
  const me = meSide ? duel[meSide] : duel.challenger;
  const them = meSide ? duel[themSide] : duel.opponent;
  const verdict = !meSide ? '' : duel.winner === 'draw' ? t('duel.draw') : duel.winner === meSide ? t('duel.youWon') : t('duel.theyWon', { name: them?.name ? esc(them.name) : esc(t('people.gone')) });
  const mine = new Map((duel.answers?.[meSide || 'challenger'] || []).map((a) => [a.id, a]));
  const theirs = new Map((duel.answers?.[meSide ? themSide : 'opponent'] || []).map((a) => [a.id, a]));
  const pill = (a) => (a ? `<span class="pts-pill ${a.correct ? (pointsOf(a) >= MAX_POINTS ? 'is-fast' : 'is-right') : 'is-wrong'}">${a.correct ? `+${pointsOf(a)}` : '0'}</span>` : '<span class="pts-pill is-none">–</span>');
  return `
    <div class="panel versus ${duel.winner === meSide ? 'is-win' : ''}">
      <p class="verdict">${verdict}</p>
      <div class="versus-row">
        <div class="versus-side ${duel.winner === (meSide || 'challenger') ? 'is-winner' : ''}">
          ${avatarImg(me.avatar, 84)}
          <span class="versus-name">${meSide ? esc(t('duel.you')) : personName(me)}</span>
          <span class="versus-score">${me.score}</span>
        </div>
        <span class="versus-vs">${esc(t('duel.vs'))}</span>
        <div class="versus-side ${duel.winner === (meSide ? themSide : 'opponent') ? 'is-winner' : ''}">
          ${avatarImg(them?.avatar, 84)}
          <span class="versus-name">${personName(them)}</span>
          <span class="versus-score">${them?.score ?? '–'}</span>
        </div>
      </div>
      <p class="result-line">${esc(t('duel.outOf', { max }))}</p>
      ${meSide ? `
        <div class="share-row">
          <button class="btn btn-marigold" data-rematch>${ICONS.duel}<span>${esc(t('duel.rematch'))}</span></button>
          <button class="btn btn-ghost-ink" data-share>${ICONS.share}<span>${esc(t('share.share'))}</span></button>
        </div>
        <p class="share-status" data-share-status aria-live="polite"></p>` : ''}
    </div>
    <h2 class="section-title">${esc(t('duel.byQuestion'))}</h2>
    <ol class="compare">
      <li class="compare-head"><span></span><span>${esc(meSide ? t('duel.you') : t('duel.first'))}</span><span>${them?.name ? `<bdi>${esc(them.name)}</bdi>` : '–'}</span></li>
      ${duel.questionIds.map((id) => QUESTION_BY_ID.get(id)).filter(Boolean).map((q) => `
        <li>
          <span class="compare-q"><strong>${esc(qt(q, q.answer))}</strong>${diffChip(q)}</span>
          ${pill(mine.get(q.id))}
          ${pill(theirs.get(q.id))}
        </li>`).join('')}
    </ol>`;
}

// ── Friends ────────────────────────────────────────────────────

const DUEL_STATUS_KEY = { yourTurn: 'duel.st.yourTurn', invited: 'duel.st.invited', waiting: 'duel.st.waiting', open: 'duel.st.waiting', done: 'duel.st.done', taken: 'duel.st.done' };

function duelRow(d) {
  const other = duelOther(d);
  const meSide = d.role;
  const mine = meSide ? d[meSide].score : null;
  const theirs = meSide ? d[meSide === 'challenger' ? 'opponent' : 'challenger']?.score : d.challenger.score;
  const result = d.status === 'done'
    ? (d.winner === 'draw' ? t('duel.draw') : d.winner === meSide ? t('duel.youWon') : t('duel.youLost'))
    : t(DUEL_STATUS_KEY[d.status] || 'duel.st.waiting');
  return `
    <li><a class="person-row duel-row is-${d.status}" href="#/duel/${d.id}">
      ${avatarImg(other?.avatar, 44)}
      <span class="person-text">${other?.name ? personName(other) : `<span class="is-hidden">${esc(t('duel.anyone'))}</span>`}<small>${esc(duelTopic(d.category))} · ${esc(result)}</small></span>
      <span class="duel-score">${mine ?? '–'}<small>:</small>${theirs ?? '–'}</span>
    </a></li>`;
}

async function showFriends() {
  const nav = navId;
  app.innerHTML = `<section class="screen friends has-tabbar">${topbar()}<h1 class="greeting">${esc(t('friends.title'))}</h1><p class="sub">${esc(t('friends.loading'))}</p></section>${tabbar('friends')}`;
  let data;
  try {
    data = await api(`/api/friends?tz=${new Date().getTimezoneOffset()}`);
    if (nav !== navId) return;
  } catch (err) {
    if (nav !== navId) return;
    if (err.status === 401) return signOut();
    app.querySelector('.sub').textContent = t('friends.loadFailed', { error: errMsg(err) });
    return;
  }
  const link = `${location.origin}/f/${data.code}?l=${lang()}`;
  const turn = data.duels.filter((d) => d.status === 'yourTurn' || d.status === 'invited');
  const waiting = data.duels.filter((d) => d.status === 'waiting' || d.status === 'open');
  const done = data.duels.filter((d) => d.status === 'done').slice(0, 8);

  app.innerHTML = `
    <section class="screen friends has-tabbar">
      ${topbar()}
      <h1 class="greeting">${esc(t('friends.title'))}</h1>

      <div class="panel invite-panel">
        <h2 class="panel-title">${esc(t('friends.invite'))}</h2>
        <p class="invite-hint">${esc(t('friends.inviteHint'))}</p>
        <p class="friend-code" dir="ltr"><span>${esc(t('friends.yourCode'))}</span><strong>${esc(data.code)}</strong></p>
        <div class="share-row">
          <button class="btn btn-marigold" data-share>${ICONS.share}<span>${esc(t('friends.shareLink'))}</span></button>
          <button class="btn btn-ghost-ink" data-copy>${ICONS.copy}<span>${esc(t('share.copyLink'))}</span></button>
        </div>
        <p class="share-status" data-share-status aria-live="polite"></p>
        <form class="add-friend" data-add novalidate>
          <label for="friend-code">${esc(t('friends.addLabel'))}</label>
          <div class="dev-row">
            <input id="friend-code" name="code" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" dir="ltr" placeholder="ABC123">
            <button class="btn btn-ghost-ink" type="submit">${esc(t('friends.add'))}</button>
          </div>
          <p class="form-msg" data-add-msg role="status"></p>
        </form>
      </div>

      <a class="duel-card" href="#/duel/new">
        <span class="duel-card-icon">${ICONS.duel}</span>
        <span class="quick-text"><strong>${esc(t('duel.cardTitle'))}</strong><span>${esc(t('duel.cardDesc'))}</span></span>
      </a>

      ${turn.length ? `<div class="panel"><h2 class="panel-title">${esc(t('friends.yourTurn'))}</h2><ul class="people">${turn.map(duelRow).join('')}</ul></div>` : ''}
      ${waiting.length ? `<div class="panel"><h2 class="panel-title">${esc(t('friends.waiting'))}</h2><ul class="people">${waiting.map(duelRow).join('')}</ul></div>` : ''}

      <div class="panel">
        <h2 class="panel-title">${esc(tn('friends.count', data.friends.length))}</h2>
        ${data.friends.length ? `<ul class="people">${data.friends.map((f) => `
          <li class="person-row">
            ${avatarImg(f.avatar, 44)}
            <span class="person-text">${personName(f)}<small>${f.streak ? `<span class="streak">${ICONS.fire}${esc(tn('friends.streak', f.streak))}</span>` : esc(t('friends.noStreak'))}${f.daily !== null ? ` · ${esc(t('friends.dailyScore', { score: f.daily }))}` : ''}</small></span>
            <button class="btn btn-small btn-marigold" data-duel="${esc(f.id)}" data-name="${esc(f.name)}">${esc(t('friends.challenge'))}</button>
            <button class="icon-btn icon-btn-ink" data-remove="${esc(f.id)}" data-name="${esc(f.name)}" aria-label="${esc(t('friends.remove', { name: f.name }))}" title="${esc(t('friends.remove', { name: f.name }))}">${ICONS.close}</button>
          </li>`).join('')}</ul>` : `<p class="board-empty">${esc(t('friends.none'))}</p>`}
      </div>

      ${done.length ? `<div class="panel"><h2 class="panel-title">${esc(t('friends.finished'))}</h2><ul class="people">${done.map(duelRow).join('')}</ul></div>` : ''}
    </section>
    ${tabbar('friends')}`;

  const status = app.querySelector('[data-share-status]');
  app.querySelector('[data-share]').addEventListener('click', async () =>
    shareStatus(status, await shareText({ text: t('friends.shareText', { code: data.code }), url: link })));
  app.querySelector('[data-copy]').addEventListener('click', async () => shareStatus(status, (await copyText(link)) ? 'copied' : 'failed'));
  app.querySelector('[data-add]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = app.querySelector('[data-add-msg]');
    const code = e.target.elements.code.value.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) {
      msg.textContent = t('friends.badCode');
      return;
    }
    try {
      const r = await api('/api/friends', { method: 'POST', body: { code } });
      msg.textContent = t(r.added ? 'friends.added' : 'friends.already', { name: r.friend.name });
      setTimeout(() => nav === navId && showFriends(), 900);
    } catch (err) {
      msg.textContent = err.status === 404 ? t('friends.noSuchCode') : errMsg(err);
    }
  });
  app.querySelectorAll('[data-duel]').forEach((b) => b.addEventListener('click', () => {
    state.duelFriend = { id: b.dataset.duel, name: b.dataset.name };
    go('#/duel/new');
  }));
  app.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    if (!window.confirm(t('friends.removeConfirm', { name: b.dataset.name }))) return;
    await api(`/api/friends/${encodeURIComponent(b.dataset.remove)}`, { method: 'DELETE' }).catch((err) => window.alert(errMsg(err)));
    showFriends();
  }));
}

/** Opened from an invite link: confirm before adding the friend. */
async function showAddFriend(code) {
  const nav = navId;
  app.innerHTML = `<section class="screen friends has-tabbar">${topbar()}<p class="sub">${esc(t('friends.loading'))}</p></section>${tabbar('friends')}`;
  let inviter;
  try {
    ({ inviter } = await api(`/api/invite/${encodeURIComponent(code)}`));
    if (nav !== navId) return;
  } catch (err) {
    if (nav !== navId) return;
    app.querySelector('.sub').textContent = errMsg(err);
    return;
  }
  const self = inviter.id === state.user.id;
  app.innerHTML = `
    <section class="screen friends has-tabbar">
      ${topbar()}
      <div class="panel challenge-card">
        ${avatarImg(inviter.avatar, 112, 'avatar-xl')}
        <h1 class="challenge-title">${self ? esc(t('friends.ownLink')) : t('friends.addQuestion', { name: personName(inviter) })}</h1>
        ${self ? '' : `<p class="challenge-sub">${esc(t('friends.addWhy'))}</p>
          <button class="btn btn-marigold btn-block" data-add-friend>${esc(t('friends.addButton'))}</button>`}
        <a class="btn btn-ghost-ink btn-block" href="#/friends">${esc(t(self ? 'friends.toFriends' : 'common.cancel'))}</a>
        <p class="form-msg" data-add-msg role="status"></p>
      </div>
    </section>
    ${tabbar('friends')}`;
  app.querySelector('[data-add-friend]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api('/api/friends', { method: 'POST', body: { code } });
      go('#/friends', { replace: true });
    } catch (err) {
      e.currentTarget.disabled = false;
      app.querySelector('[data-add-msg]').textContent = errMsg(err);
    }
  });
}

// ── Profile ────────────────────────────────────────────────────

function showProfile() {
  const p = state.profile;
  let draft = { ...parseAvatar(p.avatar) || parseAvatar(randomAvatar(state.user.id)) };
  const code = () => avatarCode(draft);
  const countries = [...COUNTRIES].sort((a, b) => countryName(a).localeCompare(countryName(b), locale()));
  const choice = (part, value, preview) =>
    `<button type="button" class="avatar-choice" data-part="${part}" data-value="${value}" aria-pressed="${draft[part] === value}" aria-label="${esc(t(`avatar.${part}.${value}`))}" title="${esc(t(`avatar.${part}.${value}`))}">${preview}</button>`;
  const groups = () => `
    <h2 class="picker-title">${esc(t('profile.animal'))}</h2>
    <div class="avatar-grid">${ANIMALS.map((a) => choice('animal', a, avatarImg(avatarCode({ ...draft, animal: a }), 64))).join('')}</div>
    <h2 class="picker-title">${esc(t('profile.face'))}</h2>
    <div class="avatar-grid">${EYES.map((e) => choice('eyes', e, avatarImg(avatarCode({ ...draft, eyes: e }), 64))).join('')}</div>
    <h2 class="picker-title">${esc(t('profile.color'))}</h2>
    <div class="swatch-grid">${Object.entries(BACKGROUNDS).map(([id, hex]) => choice('bg', id, `<span class="swatch" style="background:${hex}"></span>`)).join('')}</div>
    <h2 class="picker-title">${esc(t('profile.extra'))}</h2>
    <div class="avatar-grid">${EXTRAS.map((x) => choice('extra', x, avatarImg(avatarCode({ ...draft, extra: x }), 64))).join('')}</div>`;

  app.innerHTML = `
    <section class="screen profile has-tabbar">
      ${topbar()}
      <h1 class="greeting">${esc(t('profile.title'))}</h1>
      <div class="profile-preview">
        <span data-preview>${avatarImg(code(), 140, 'avatar-xl')}</span>
        <button type="button" class="btn btn-small btn-ghost" data-random>${ICONS.dice}<span>${esc(t('profile.random'))}</span></button>
      </div>
      <form class="panel profile-form" data-form novalidate>
        <label class="field">
          <span>${esc(t('profile.name'))}</span>
          <input name="name" maxlength="20" value="${esc(p.name)}" autocomplete="nickname" required>
        </label>
        <div data-groups>${groups()}</div>
        <label class="field">
          <span>${esc(t('profile.country'))}</span>
          <span class="country-row">
            <span data-flag>${flagImg(p.country)}</span>
            <select name="country">
              <option value="">${esc(t('profile.noCountry'))}</option>
              ${countries.map((c) => `<option value="${c}" ${c === p.country ? 'selected' : ''}>${esc(countryName(c))}</option>`).join('')}
            </select>
          </span>
        </label>
        <label class="setting">
          <span><strong>${esc(t('profile.showOnBoards'))}</strong><span>${esc(t('profile.showHint'))}</span></span>
          <input type="checkbox" class="switch" name="shown" ${p.hidden ? '' : 'checked'}>
        </label>
        <p class="form-msg" data-msg role="status"></p>
        <button class="btn btn-marigold btn-block" type="submit">${esc(t('profile.save'))}</button>
      </form>
    </section>
    ${tabbar('progress')}`;

  const redraw = () => {
    app.querySelector('[data-preview]').innerHTML = avatarImg(code(), 140, 'avatar-xl');
    app.querySelector('[data-groups]').innerHTML = groups();
  };
  app.querySelector('[data-groups]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-part]');
    if (!b) return;
    draft = { ...draft, [b.dataset.part]: b.dataset.value };
    redraw();
    app.querySelector(`[data-part="${b.dataset.part}"][data-value="${b.dataset.value}"]`)?.focus({ preventScroll: true });
  });
  app.querySelector('[data-random]').addEventListener('click', () => {
    draft = parseAvatar(randomAvatar());
    redraw();
  });
  const form = app.querySelector('[data-form]');
  form.elements.country.addEventListener('change', () => {
    app.querySelector('[data-flag]').innerHTML = flagImg(form.elements.country.value || null);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = app.querySelector('[data-msg]');
    const name = form.elements.name.value.trim();
    if (!name) {
      msg.textContent = t('profile.needName');
      return;
    }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const { profile } = await api('/api/profile', {
        method: 'PUT',
        body: { name, avatar: code(), country: form.elements.country.value || null, hidden: !form.elements.shown.checked },
      });
      state.profile = profile;
      go('#/progress');
    } catch (err) {
      btn.disabled = false;
      msg.textContent = errMsg(err);
    }
  });
}

// ── Reminders (push notifications) ─────────────────────────────

const urlBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/**
 * Makes sure this browser can receive reminders: asks permission and subscribes it.
 * Resolves to 'ok', 'denied', 'install' (iPhone: install the app first) or 'unsupported'.
 */
async function ensurePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isInstalled() ? 'install' : 'unsupported';
  }
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return 'denied';
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
  if (!reg) return 'unsupported';
  try {
    const sub = (await reg.pushManager.getSubscription())
      || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBytes(state.config.pushKey) }));
    await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
    return 'ok';
  } catch {
    return 'unsupported';
  }
}

function bindReminders() {
  const note = app.querySelector('[data-remind-note]');
  app.querySelectorAll('[data-remind]').forEach((box) => box.addEventListener('change', async () => {
    const name = box.dataset.remind;
    note.hidden = true;
    if (!box.checked) return setSetting(name, false);
    box.disabled = true;
    const result = await ensurePush();
    box.disabled = false;
    if (result === 'ok') return setSetting(name, true);
    box.checked = false;
    note.textContent = t(`remind.${result}`);
    note.hidden = false;
  }));
}

// ── Install the app ────────────────────────────────────────────
// The Progress page offers to install Smarts on the home screen: Chrome and Android show
// their own install prompt, iPhones get the Add to Home Screen steps. Each player sees the
// offer on at most INSTALL_SHOWS visits to the Progress page (counted on this device), and
// never again once they install.

const INSTALL_SHOWS = 20;
let installPrompt = null; // the browser's install prompt, saved for our button
let installCounted = false; // this visit to the Progress page has been counted already

const installKey = () => `smarts:${state.user.id}:installShown`;
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function installShows() {
  try {
    return Number(localStorage.getItem(installKey())) || 0;
  } catch {
    return INSTALL_SHOWS; // storage blocked: skip the offer rather than show it forever
  }
}

function stopInstallOffer() {
  try { if (state.user) localStorage.setItem(installKey(), String(INSTALL_SHOWS)); } catch { /* storage blocked */ }
  document.querySelector('.install-panel')?.remove();
}

window.addEventListener('beforeinstallprompt', (e) => {
  // Once the offer has been used up, leave the browser's own install bar alone.
  if (state.user && installShows() >= INSTALL_SHOWS) return;
  e.preventDefault();
  installPrompt = e;
  mountInstall(); // the prompt can arrive after the page is drawn
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  stopInstallOffer();
});

/** Puts the install offer on the Progress page, if this device can install and the player hasn't used up their 20 views. */
function mountInstall() {
  const slot = app.querySelector('[data-install-slot]');
  if (!slot || slot.firstElementChild || !state.user || isInstalled() || !(installPrompt || isIos())) return;
  if (!installCounted) {
    const shown = installShows();
    if (shown >= INSTALL_SHOWS) return;
    try {
      localStorage.setItem(installKey(), String(shown + 1));
    } catch {
      return;
    }
    installCounted = true;
  }
  slot.innerHTML = `
    <div class="panel install-panel">
      <img class="install-icon" src="/icons/icon-192.png" alt="" width="52" height="52">
      <span class="install-text"><strong>${esc(t('install.title'))}</strong><span>${esc(t('install.text'))}</span></span>
      <button type="button" class="btn btn-marigold btn-block" data-install>${esc(t('install.button'))}</button>
    </div>`;
  slot.querySelector('[data-install]').addEventListener('click', (e) => installApp(e.currentTarget));
}

async function installApp(btn) {
  if (!installPrompt) return openIosInstall(btn);
  const prompt = installPrompt;
  installPrompt = null; // a prompt can only be shown once
  prompt.prompt();
  const { outcome } = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
  if (outcome === 'accepted') stopInstallOffer();
  else document.querySelector('.install-panel')?.remove(); // back next visit, if the browser offers again
}

/** iPhones can't install from a button, so show the steps instead. */
function openIosInstall(opener) {
  const scrim = document.createElement('div');
  scrim.className = 'sheet-scrim';
  scrim.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <h2 id="install-title">${esc(t('install.iosTitle'))}</h2>
      <ol class="install-steps">
        <li>${esc(t('install.ios1'))}</li>
        <li>${esc(t('install.ios2'))}</li>
        <li>${esc(t('install.ios3'))}</li>
      </ol>
      <button type="button" class="btn btn-marigold btn-block sheet-done" data-install-close>${esc(t('common.done'))}</button>
    </div>`;
  document.body.append(scrim);
  const close = () => {
    scrim.remove();
    opener?.focus?.({ preventScroll: true });
  };
  scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim || e.target.closest('[data-install-close]')) close();
  });
  scrim.querySelector('[data-install-close]').focus();
}

// ── Progress ───────────────────────────────────────────────────

async function showProgress() {
  const user = state.user;
  if (!rerendering) installCounted = false; // a language change redraws without counting a new view
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
        <a href="#/profile" class="avatar-link" aria-label="${esc(t('profile.edit'))}">${avatar()}</a>
      </header>

      <h1 class="greeting">${esc(t('prog.title'))}</h1>
      <a class="panel profile-card" href="#/profile">
        ${avatar(state.profile?.avatar, 60)}
        <span class="person-text"><span>${personName({ ...state.profile, hidden: false })}</span><small>${esc(t(state.profile?.hidden ? 'profile.hiddenNote' : 'profile.editHint'))}</small></span>
        <span class="profile-edit">${ICONS.edit}</span>
      </a>
      <div data-install-slot></div>

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
        <h3 class="setting-group">${ICONS.bell}<span>${esc(t('remind.title'))}</span></h3>
        <label class="setting">
          <span><strong>${esc(t('remind.daily'))}</strong><span>${esc(t('remind.dailyHint'))}</span></span>
          <input type="checkbox" class="switch" data-remind="notifyDaily" ${getSetting('notifyDaily', false) ? 'checked' : ''}>
        </label>
        <label class="setting">
          <span><strong>${esc(t('remind.friends'))}</strong><span>${esc(t('remind.friendsHint'))}</span></span>
          <input type="checkbox" class="switch" data-remind="notifyFriends" ${getSetting('notifyFriends', false) ? 'checked' : ''}>
        </label>
        <p class="remind-note" data-remind-note role="status" hidden></p>
      </div>

      <div class="account">
        <p>${t('acc.signedInAs', { name: esc(user.name) })}${user.email ? ` <span dir="ltr">(${esc(user.email)})</span>` : user.provider === 'dev' ? ` ${esc(t('acc.localName'))}` : ''}</p>
        <button class="btn btn-ghost" data-signout>${esc(t('acc.signOut'))}</button>
        <div class="account-links">
          ${user.admin ? `<a class="link-btn" href="#/admin/players">${esc(t('acc.players'))}</a><a class="link-btn" href="#/admin">${esc(t('acc.reports'))}</a>` : ''}
          <button class="link-btn" data-signout-all>${esc(t('acc.signOutAll'))}</button>
          <a class="link-btn" href="/api/account/export" download>${esc(t('acc.download'))}</a>
          <button class="link-btn link-danger" data-delete-account>${esc(t('acc.delete'))}</button>
          ${legalLinks('link-btn')}
        </div>
      </div>
    </section>
    ${tabbar('progress')}`;

  mountInstall();
  bindReminders();
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

// ── Admin ──────────────────────────────────────────────────────

/** The admin screens share a header with links to each of them. */
function adminFrame(section, body) {
  const link = (id, href) =>
    `<a class="admin-section ${id === section ? 'is-active' : ''}" href="${href}" ${id === section ? 'aria-current="page"' : ''}>${esc(t(`admin.nav.${id}`))}</a>`;
  return `
    <section class="screen admin has-tabbar">
      <header class="topbar"><span class="logo">Smarts</span></header>
      <nav class="admin-sections" aria-label="${esc(t('admin.nav.aria'))}">${link('players', '#/admin/players')}${link('reports', '#/admin')}</nav>
      ${body}
    </section>
    ${tabbar('progress')}`;
}

// ── Admin: players and retention ───────────────────────────────

// What "good" looks like, from the money plan: shown next to each number.
const RETURN_GOALS = { 1: 30, 7: 15 };
const STICKINESS_GOAL = 20;

async function showPlayers() {
  const nav = navId;
  const frame = (body) => adminFrame('players', `<h1 class="section-title">${esc(t('players.title'))}</h1>${body}`);
  app.innerHTML = frame(`<p class="sub">${esc(t('players.loading'))}</p>`);
  let r;
  try {
    r = await api(`/api/admin/retention?tz=${new Date().getTimezoneOffset()}`);
    if (nav !== navId) return;
  } catch (err) {
    if (nav !== navId) return;
    if (err.status === 401) return signOut();
    app.querySelector('.sub').textContent = t('players.loadFailed', { error: errMsg(err) });
    return;
  }

  const pct = (x, y) => (y ? Math.round((x / y) * 100) : null);
  const day = (iso, opts = { day: 'numeric', month: 'short' }) => fmtDate(new Date(`${iso}T12:00:00`), opts);
  const sticky = pct(r.dauAvg7, r.mau);
  const returnCell = (x) => {
    const p = pct(x.back, x.eligible);
    return p === null ? '<td class="num is-muted">–</td>' : `<td class="num" title="${esc(t('players.dOf', { x: x.back, y: x.eligible }))}">${p}%</td>`;
  };
  const maxDaily = Math.max(1, ...r.daily.map((d) => d.active));
  const maxMonth = Math.max(1, ...r.months.map((m) => m.players));

  app.innerHTML = frame(`
    <dl class="facts">
      <div><dt>${esc(t('players.today'))}</dt><dd>${r.dau}</dd><p>${esc(t('players.avg7', { n: r.dauAvg7 }))}</p></div>
      <div><dt>${esc(t('players.week'))}</dt><dd>${r.wau}</dd><p>${esc(t('players.allTime', { n: r.players }))}</p></div>
      <div><dt>${esc(t('players.month'))}</dt><dd>${r.mau}</dd><p>${esc(t('players.newMonth', { n: r.newLast30 }))}</p></div>
      <div><dt>${esc(t('players.sticky'))}</dt><dd>${sticky === null ? '–' : `${sticky}%`}</dd><p>${esc(t('players.goal', { p: STICKINESS_GOAL }))}</p></div>
    </dl>

    <div class="panel">
      <h2 class="panel-title">${esc(t('players.returns'))}</h2>
      <ul class="returns">
        ${r.returns.map((x) => {
          const p = pct(x.back, x.eligible);
          const goal = RETURN_GOALS[x.n];
          return `
            <li>
              <span class="returns-head"><strong>${esc(t('players.dayN', { n: x.n }))}</strong><span>${esc(x.eligible ? t('players.dOf', { x: x.back, y: x.eligible }) : t('players.noData'))}</span></span>
              <span class="returns-num ${p !== null && goal && p >= goal ? 'is-good' : ''}">${p === null ? '–' : `${p}%`}</span>
              <span class="meter meter-ink returns-meter"><span style="width:${p ?? 0}%"></span>${goal ? `<i style="inset-inline-start:${goal}%" title="${esc(t('players.goal', { p: goal }))}"></i>` : ''}</span>
            </li>`;
        }).join('')}
      </ul>
      <p class="legend">${esc(t('players.returnsHint'))}</p>
    </div>

    <div class="panel">
      <h2 class="panel-title">${esc(t('players.daily'))}</h2>
      <div class="days" role="img" aria-label="${esc(t('players.daily'))}">
        ${r.daily.map((d) => `
          <span class="day" title="${esc(t('players.dayTitle', { date: day(d.date), n: d.active, new: d.new }))}">
            <span class="day-bar${d.active ? '' : ' is-empty'}" style="height:${(d.active / maxDaily) * 100}%"><span class="is-back" style="height:${d.active ? ((d.active - d.new) / d.active) * 100 : 0}%"></span></span>
          </span>`).join('')}
      </div>
      <div class="days-axis"><span>${esc(day(r.daily[0].date))}</span><span>${esc(t('prog.today'))}</span></div>
      <p class="legend"><span class="sw sw-back"></span>${esc(t('players.legendBack'))} <span class="sw sw-new"></span>${esc(t('players.legendNew'))}</p>
    </div>

    <div class="panel">
      <h2 class="panel-title">${esc(t('players.cohorts'))}</h2>
      <div class="table-scroll">
        <table class="admin-table">
          <thead><tr><th>${esc(t('players.colFirst'))}</th><th class="num">${esc(t('players.colPlayers'))}</th>${r.returns.map((x) => `<th class="num">${esc(t('players.dayN', { n: x.n }))}</th>`).join('')}</tr></thead>
          <tbody>
            ${r.cohorts.map((c) => `
              <tr><td>${esc(day(c.from))} – ${esc(day(c.to))}</td><td class="num">${c.players}</td>${c.returns.map(returnCell).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h2 class="panel-title">${esc(t('players.monthly'))}</h2>
      <ul class="months">
        ${r.months.map((m) => `
          <li><span>${esc(day(`${m.month}-15`, { month: 'long', year: 'numeric' }))}</span><span class="meter meter-ink"><span style="width:${(m.players / maxMonth) * 100}%"></span></span><strong>${m.players}</strong></li>`).join('')}
      </ul>
    </div>

    <div class="panel">
      <h2 class="panel-title">${esc(t('players.events'))}</h2>
      <div class="table-scroll">
        <table class="admin-table">
          <thead><tr><th>${esc(t('players.colEvent'))}</th><th class="num">${esc(t('players.col7'))}</th><th class="num">${esc(t('players.col30'))}</th><th class="num">${esc(t('players.colWho'))}</th></tr></thead>
          <tbody>
            ${r.events.map((e) => `<tr><td>${esc(t(`event.${e.name}`))}</td><td class="num">${e.week}</td><td class="num">${e.month}</td><td class="num">${e.players}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <p class="sub admin-note">${esc(t('players.note'))}</p>`);
}

// ── Admin: question reports ────────────────────────────────────

const REASON_BY_ID = Object.fromEntries(REPORT_REASONS.map((r) => [r.id, r]));
const STATUS_TABS = ['open', 'fixed', 'dismissed'];

async function showAdmin(status = 'open') {
  if (status === 'players') return showPlayers();
  if (!STATUS_TABS.includes(status)) status = 'open';
  const nav = navId;
  const tabs = STATUS_TABS.map((s) =>
    `<a class="admin-tab ${s === status ? 'is-active' : ''}" href="#/admin/${s}" ${s === status ? 'aria-current="page"' : ''}>${esc(t(`admin.tab.${s}`))}</a>`).join('');
  const frame = (body) => adminFrame('reports', `
      <h1 class="section-title">${esc(t('admin.title'))}</h1>
      <nav class="admin-tabs" aria-label="${esc(t('admin.statusAria'))}">${tabs}</nav>
      ${body}`);
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
