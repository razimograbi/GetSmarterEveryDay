import { QUESTIONS, QUESTION_BY_ID } from '/shared/questions.js';
import {
  MODES, DEFAULT_MODE, CATEGORIES, CATEGORY_BY_ID, AUTO_DELAY, BACK_BUTTON, BOARD, REPORT_REASONS, REPORT_NOTE_MAX, MAX_POINTS, XP, STAGE, STAGE_PICTURE_HOSTS, inQuickRounds, pointsFor, secondsFor, localDate, levelFor, levelProgress, tierFor, xpForRound,
} from '/shared/config.js';
import { avatarUrl, avatarCode, backgroundCss, nextUnlock, parseAvatar, randomAvatar, unlockLevel, ANIMALS, EYES, BACKGROUNDS, EXTRAS, UNLOCKS } from '/shared/avatars.js';
import { COUNTRIES } from '/shared/countries.js';
import { pickLevel, subjectOf } from '/shared/levels.js';
import { squareFor, copyText, shareText, shareImage, resultImage } from './share.js';
import { render as renderVisual, preload, isPreloaded, fetchNow, missingHtml, loadLocalImages, thumb } from './visuals.js';
import { signSvg } from './signs.js';
import { ICONS } from './icons.js';
import { coverUrl } from './covers.js';
import { api, esc, shuffle, reduceMotion } from './util.js';
import {
  LANGUAGES, lang, setLang, savedLang, rememberLang, deviceLang, isLang, locale, t, tn, qt, catName, catBlurb, reasonLabel, timeAgo, fmtDate,
} from './i18n.js';

const app = document.getElementById('app');
const state = {
  config: null, user: null, settings: null, profile: null, stats: null, lastRound: null,
  daily: null, // today's Daily and the player's result, for the home screen
  duels: null, // the player's duels, for the home screen
  stages: null, // the published Leveling stages as this player stands on them
  fixedRound: null, // a Daily or duel about to be played
  duelFriend: null, // the friend a new duel is for
  played: 0, // rounds finished, from the server at sign-in; 0 means a new player (see isNew)
  justUnlocked: false, // the first round was just finished: say once what the home screen gained
  newFriend: null, // a new player who added a friend from an invite link: offered as a duel at home
  levelUp: null, // { from, to }: levels gained that haven't been celebrated yet
};

/**
 * A player who hasn't finished a round yet. They get a simpler home screen with one button,
 * a "how it works" strip wherever their first round starts, and no tab bar.
 */
const isNew = () => !state.played;

/** Counts a finished round. The first one unlocks the full home screen. */
function countFinished() {
  if (!state.played) state.justUnlocked = true;
  state.played += 1;
}
let cleanup = () => {};
let navId = 0; // bumps on every screen change; async screens check it before drawing
let pendingSave = Promise.resolve(); // the last round's answers still on their way to the server; never rejects

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
    state.played = me.played || 0;
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
  if (state.user) await finishLeftRound();
  window.addEventListener('hashchange', route);
  // The Back arrow is in many top bars, so one listener serves them all.
  app.addEventListener('click', (e) => { if (e.target.closest('[data-back]')) goBack(); });
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
  if ((m = /^\/duel\/([A-Z2-9]{8})\/?$/.exec(path))) hash = `#/duel/${m[1]}`;
  else if ((m = /^\/f\/([A-Za-z2-9]{6})\/?$/.exec(path))) hash = `#/add/${m[1].toUpperCase()}`;
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
  if (replace) {
    replacingNav = true;
    location.replace(hash); // keeps Back from restarting a finished round
  } else {
    location.hash = hash;
  }
}

// How many of the app's own screens are behind this one in the browser history. Each entry is
// stamped with it, so the Back arrow only steps back inside the app, never out to another site.
let navDepth = -1;
let replacingNav = false;

function stampNavDepth() {
  const depth = history.state?.depth;
  if (typeof depth === 'number') navDepth = depth;
  else {
    navDepth = replacingNav ? Math.max(0, navDepth) : navDepth + 1;
    history.replaceState({ ...history.state, depth: navDepth }, '');
  }
  replacingNav = false;
}

/** The Back arrow: the previous screen, or home when this is the first one. */
function goBack() {
  if (navDepth > 0) history.back();
  else go('#/', { replace: true });
}

/** Whether this player sees the Back arrow: their setting, where 'phones' means a touch screen. */
function showBack() {
  const mode = BACK_BUTTON.includes(getSetting('backButton')) ? getSetting('backButton') : 'phones';
  return mode === 'always' || (mode === 'phones' && matchMedia('(hover: none) and (pointer: coarse)').matches);
}

/** The start of a screen's top bar: the Back arrow (if shown) and the logo, which leads home. */
const topbarStart = () => `
  <span class="topbar-start">
    ${showBack() ? `<button type="button" class="icon-btn back-btn" data-back aria-label="${esc(t('nav.back'))}">${ICONS.back}</button>` : ''}
    <a class="logo logo-link" href="#/" aria-label="${esc(t('tab.home'))}">Smarts</a>
  </span>`;

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
  stampNavDepth();
  closeReport?.();
  cleanup();
  cleanup = () => {};
  document.querySelector('.lang-sheet')?.parentElement.remove();
  document.querySelector('.levelup-sheet')?.parentElement.remove();
  if (!rerendering) window.scrollTo(0, 0);
  if (!state.user) return showSignIn();
  showLevelUp();

  const [, page, arg, sub] = (location.hash || '#/').split('/');
  if (page === 'play' && (arg === 'daily' || arg === 'duel' || arg === 'stage')) {
    const fixed = state.fixedRound;
    state.fixedRound = null;
    return fixed?.kind === arg ? startRound(arg, fixed) : go('#/', { replace: true });
  }
  if (page === 'play' && (arg === 'mixed' || arg === 'review' || CATEGORY_BY_ID[arg])) return startRound(arg);
  if (page === 'daily') return showDaily();
  if (page === 'leveling') return arg ? showStageResult(Number(arg)) : showLeveling();
  if (page === 'duel' && arg === 'new') return showDuelNew();
  if (page === 'duel' && arg) return showDuel(arg);
  if (page === 'friends') return showFriends();
  if (page === 'add' && arg) return showAddFriend(arg);
  if (page === 'profile') return showProfile();
  if (page === 'results' && state.lastRound) return showResults();
  if (page === 'progress') return showProgress();
  if (page === 'admin' && state.user.admin) return showAdmin(arg, sub);
  return showHome();
}

/**
 * Fills in questions the server has sent. The bank this page starts with has only ids and topics,
 * so that it can't be read for answers: what a question says arrives when it's about to be played,
 * or once the player has answered it.
 */
function learn(questions) {
  for (const content of Object.values(questions || {})) {
    const q = QUESTION_BY_ID.get(content.id);
    if (q) Object.assign(q, content);
  }
}

/** Gets the words, options and answers of these Quick or topic questions, unless they're already here. */
async function loadQuestions(list) {
  const ids = list.filter((q) => !q.options).map((q) => q.id);
  if (ids.length) learn((await api('/api/questions', { method: 'POST', body: { ids } })).questions);
}

async function loadStats(force = false) {
  if (state.stats && !force) return state.stats;
  await pendingSave; // otherwise the numbers would miss the round just played
  const s = await api(`/api/stats?tz=${new Date().getTimezoneOffset()}`);
  learn(s.questions);
  // Answers to questions that were removed (e.g. the old Islands topic) stay in the
  // history but don't count toward "x of 400".
  const known = (ids) => ids.filter((id) => QUESTION_BY_ID.has(id));
  s.seenIds = known(s.seenIds);
  s.masteredIds = known(s.masteredIds);
  if (s.rounds > state.played) state.played = s.rounds; // e.g. a round finished on another device
  state.stats = s;
  applyXp(s.xp);
  return s;
}

/** Takes in the player's XP from the server. A higher level is celebrated (see showLevelUp). */
function applyXp(xp) {
  const p = state.profile;
  if (!p || typeof xp !== 'number') return;
  const level = levelFor(xp);
  if (level > p.level) state.levelUp = { from: state.levelUp?.from ?? p.level, to: level };
  p.xp = xp;
  p.level = level;
  showLevelUp();
}

/** "Level up!" with what it unlocked, once the player isn't in the middle of a round. */
function showLevelUp() {
  const up = state.levelUp;
  if (!up || location.hash.startsWith('#/play') || document.querySelector('.levelup-sheet')) return;
  state.levelUp = null;
  const p = state.profile;
  const tier = tierFor(up.to);
  const newTier = tierFor(up.from).id !== tier.id;
  const unlocked = UNLOCKS.filter((u) => u.level > up.from && u.level <= up.to);
  const next = nextUnlock(up.to);
  const opener = document.activeElement;
  const scrim = document.createElement('div');
  scrim.className = 'sheet-scrim';
  scrim.innerHTML = `
    <div class="sheet levelup-sheet" role="dialog" aria-modal="true" aria-labelledby="levelup-title">
      ${coveredAvatar(p, 96)}
      <h2 id="levelup-title">${esc(t('level.up'))}</h2>
      <p>${esc(t(newTier ? 'level.reachedTier' : 'level.reached', { n: up.to, tier: t(`level.tier.${tier.id}`) }))}</p>
      ${unlocked.length ? `
        <h3 class="levelup-new">${esc(t('level.unlocked'))}</h3>
        <ul class="levelup-items">${unlocked.map((u) => `
          <li>${unlockPreview(u, 64)}<span>${esc(t(`avatar.${u.part}.${u.value}`))}</span></li>`).join('')}</ul>` : `
        <p>${esc(next ? t('level.nextAt', { n: next.level }) : t('level.allUnlocked'))}</p>`}
      <div class="sheet-actions">
        <button type="button" class="btn btn-ghost-ink" data-levelup-close>${esc(t('level.nice'))}</button>
        <a class="btn btn-marigold" href="#/profile">${esc(t('level.tryOn'))}</a>
      </div>
    </div>`;
  document.body.append(scrim);
  const close = () => {
    scrim.remove();
    opener?.focus?.({ preventScroll: true });
  };
  scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim || e.target.closest('[data-levelup-close]')) close();
    else if (e.target.closest('a')) {
      if (unlocked.length) profileTab = unlocked[0].part;
      scrim.remove();
    }
  });
  scrim.querySelector('[data-levelup-close]').focus({ preventScroll: true });
}

// ── Sign in ────────────────────────────────────────────────────

/**
 * Apps like WhatsApp, Instagram and Facebook open links in their own built-in browser. There,
 * Google's sign-in window opens blank and never comes back (Google blocks sign-in in many of
 * them on purpose). Returns null in a real browser, else 'android' or 'ios': the way out differs.
 */
function inAppBrowser() {
  if (navigator.standalone || matchMedia('(display-mode: standalone)').matches) return null; // installed app
  const ua = navigator.userAgent;
  const app = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|WhatsApp|Telegram|Line\/|Snapchat|TikTok|musical_ly|BytedanceWebview|LinkedInApp|Twitter|MicroMessenger/i.test(ua);
  if (/Android/i.test(ua)) return app || /; wv\)/.test(ua) ? 'android' : null; // "; wv)": an app's WebView
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && (app || !/Safari\//.test(ua)) ? 'ios' : null; // every real iOS browser says "Safari/"
}

/** The page as the plain link that was shared (/duel/…, /f/…, /daily), so a real browser opens the same thing. */
function sharedLink() {
  const [, page, arg] = (location.hash || '').split('/');
  const path = page === 'duel' && arg ? `/duel/${arg}` : page === 'add' && arg ? `/f/${arg}` : page === 'daily' ? '/daily' : '/';
  return `${location.origin}${path}`;
}

/** Instead of the Google button, inside an in-app browser: how to open Smarts in the phone's own browser. */
function inAppCard(os) {
  const url = new URL(sharedLink());
  // Android opens an intent: link in Chrome; if Chrome is missing, the fallback opens the link as usual.
  const intent = `intent://${url.host}${url.pathname}#Intent;scheme=${url.protocol.slice(0, -1)};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url.href)};end`;
  return `
    <div class="signin-card inapp-card">
      <h2>${esc(t('inapp.title'))}</h2>
      <p>${esc(t('inapp.why'))}</p>
      ${os === 'android'
        ? `<a class="btn btn-marigold btn-block" href="${esc(intent)}">${esc(t('inapp.openChrome'))}</a>`
        : `<ol class="inapp-steps"><li>${esc(t('inapp.ios1'))}</li><li>${esc(t('inapp.ios2'))}</li></ol>`}
      <button type="button" class="btn btn-ghost-ink btn-block" data-copy-link>${ICONS.copy}<span>${esc(t('inapp.copy'))}</span></button>
      <p class="inapp-status" data-copy-status aria-live="polite"></p>
      <button type="button" class="link-btn inapp-try" data-try-here>${esc(t('inapp.tryHere'))}</button>
      <div id="google-btn" class="google-btn" hidden></div>
    </div>`;
}

function showSignIn() {
  const { googleClientId, devLogin } = state.config;
  const inApp = inAppBrowser();
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
        ${googleClientId && inApp ? inAppCard(inApp) : ''}
        ${googleClientId && !inApp ? `
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

  if (googleClientId && !inApp) mountGoogleButton(googleClientId, showError);
  showLinkBanner();

  // In an in-app browser: copy the link for a real browser, or try Google's sign-in here anyway.
  app.querySelector('[data-copy-link]')?.addEventListener('click', async () => {
    app.querySelector('[data-copy-status]').textContent = t((await copyText(sharedLink())) ? 'inapp.copied' : 'share.failed');
  });
  app.querySelector('[data-try-here]')?.addEventListener('click', (e) => {
    e.currentTarget.remove();
    app.querySelector('#google-btn').hidden = false;
    mountGoogleButton(googleClientId, showError);
  });

  app.querySelector('.dev-login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name');
    try {
      await signedIn(await api('/api/auth/dev', { method: 'POST', body: { name } }));
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
          await signedIn(await api('/api/auth/google', { method: 'POST', body: { credential } }));
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

/** Takes the server's sign-in reply; `locale` is the Google account's language, when known. */
async function signedIn({ user, settings, profile = null, played = 0, locale = null }) {
  state.user = user;
  state.profile = profile;
  state.played = played;
  adoptSettings(settings);
  await adoptLanguage(settings, locale);
  await finishLeftRound();
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
  state.stages = null;
  state.daily = null;
  state.duels = null;
  state.played = 0;
  state.justUnlocked = false;
  state.newFriend = null;
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
        <p class="report-q">${esc(qt(q, q.prompt))}${q.answer ? ` <strong>${esc(t('report.answer', { answer: qt(q, q.answer) }))}</strong>` : ''}</p>
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

const reportBtn = (q) => (q?.cat === 'stage' ? '' : `<button class="icon-btn report-btn" data-report aria-label="${esc(t('report.button'))}" title="${esc(t('report.button'))}">${ICONS.report}</button>`);

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
const avatar = (code = state.profile?.avatar, size = 36) => coveredAvatar({ avatar: code, level: state.profile?.level }, size);

/** The tab bar. New players don't get one until their first round (see isNew); the logo leads home. */
function tabbar(active) {
  if (isNew()) return '';
  return `
    <nav class="tabbar" aria-label="Main">
      <a href="#/" class="${active === 'home' ? 'is-active' : ''}" ${active === 'home' ? 'aria-current="page"' : ''}>${ICONS.home}<span>${esc(t('tab.home'))}</span></a>
      <a href="#/friends" class="${active === 'friends' ? 'is-active' : ''}" ${active === 'friends' ? 'aria-current="page"' : ''}>${ICONS.friends}<span>${esc(t('tab.friends'))}</span></a>
      <a href="#/progress" class="${active === 'progress' ? 'is-active' : ''}" ${active === 'progress' ? 'aria-current="page"' : ''}>${ICONS.chart}<span>${esc(t('tab.progress'))}</span></a>
    </nav>`;
}

// ── Home ───────────────────────────────────────────────────────

// The home screen previews a few topics under the Quick round card, with a button to
// show the rest. Opened stays opened while the app is open, so redraws don't fold it again.
const TOPIC_PREVIEW = 3;
let topicsOpen = false;
// Topics the player has answered most come first, so the preview shows their own topics.
// Kept between draws: stats are briefly missing after a round, and the list shouldn't jump.
let topicOrder = CATEGORIES;
// "Unlocked: …" shows on the first home screen after the first round. A language change redraws it.
let lastUnlocked = false;

function orderTopics(stats) {
  if (!stats) return topicOrder;
  const answered = Object.fromEntries(stats.byCategory.map((c) => [c.category, c.answered]));
  return (topicOrder = [...CATEGORIES].sort((a, b) => (answered[b.id] || 0) - (answered[a.id] || 0)));
}

/** A title and three numbered steps. `steps` are already safe HTML. */
const stepsCard = (title, steps) => `
  <div class="how">
    <h2 class="how-title">${esc(title)}</h2>
    <ol>${steps.map((s, i) => `<li><span class="how-n">${i + 1}</span><span>${s}</span></li>`).join('')}</ol>
  </div>`;

/** "See a picture · Tap the right answer · Beat the clock": shown wherever a new player's first round starts. */
const howItWorks = () =>
  stepsCard(t('how.title'), [t('how.see'), t('how.tap'), t('how.clock', { secs: MODES[DEFAULT_MODE].secondsPerQuestion })].map(esc));

/** The one big button on the home screen: a label that says what happens, and what it is. */
const playCta = (label, sub) => `
  <a class="play-cta" href="#/play/mixed">
    <span class="play-cta-label"><span>${esc(label)}</span>${ICONS.arrow}</span>
    <span class="play-cta-sub">${esc(sub)}</span>
  </a>`;

/** A quieter row under the big button: icon, title, a line or a badge, and a chevron. */
const homeRow = ({ href = null, data = '', icon, title, sub = '', badge = '' }) => `
  ${href ? `<a class="home-row" href="${href}"` : `<button type="button" class="home-row" ${data}`}>
    <span class="home-row-icon">${icon}</span>
    <span class="home-row-text"><strong>${title}</strong>${sub ? `<span>${sub}</span>` : ''}</span>
    ${badge ? `<span class="home-row-badge">${esc(badge)}</span>` : ''}
    <span class="home-row-chevron" aria-hidden="true">${ICONS.chevron}</span>
  ${href ? '</a>' : '</button>'}`;

/** Today's Daily as a row: "New today" until it's played, then the score and the board. */
function dailyRow(d) {
  const played = d?.result?.finished;
  const n = d?.number;
  return homeRow({
    href: '#/daily',
    icon: ICONS.daily,
    title: esc(n ? t('daily.title', { n }) : t('daily.titlePlain')),
    sub: esc(played ? `${t('daily.youScored', { score: d.result.score, max: d.count * MAX_POINTS })} · ${t('daily.seeBoard')}` : t('daily.rowDesc')),
    badge: played ? '' : t('daily.newToday'),
  });
}

/** Rows for duels that need the player: a result to see, or a turn to take. */
function duelAlerts() {
  const duels = state.duels || [];
  const ready = duels.filter((d) => d.resultReady);
  const turn = duels.filter((d) => d.status === 'yourTurn' || d.status === 'invited');
  const rows = [];
  if (ready.length) {
    rows.push(homeRow({
      href: ready.length > 1 ? '#/friends' : `#/duel/${ready[0].id}`,
      icon: ICONS.duel,
      title: ready.length > 1 ? esc(tn('duel.homeReadyMany', ready.length)) : t('duel.homeReady', { name: personName(duelOther(ready[0])) }),
      sub: esc(t('duel.homeReadySub')),
      badge: t('duel.badgeReady'),
    }));
  }
  if (turn.length) {
    const other = duelOther(turn[0]);
    const challenger = turn[0].role !== 'challenger' && other?.name;
    rows.push(homeRow({
      href: turn.length > 1 ? '#/friends' : `#/duel/${turn[0].id}`,
      icon: ICONS.duel,
      title: turn.length > 1 ? esc(tn('duel.homeTurns', turn.length)) : challenger ? t('duel.challengedYou', { name: personName(other) }) : esc(t('duel.title')),
      sub: turn.length > 1 ? '' : esc(t('duel.homeTurnSub', { topic: duelTopic(turn[0].category) })),
      badge: t('duel.yourTurn'),
    }));
  }
  return rows.length ? `<div class="home-rows">${rows.join('')}</div>` : '';
}

function topicRows(stats) {
  const gotRight = Object.fromEntries((stats?.byCategory || []).map((c) => [c.category, c.gotRight]));
  return orderTopics(stats).map((c) => {
    const m = gotRight[c.id] || 0;
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
  }).join('');
}

function homeTopbar({ withAvatar = true } = {}) {
  const current = LANGUAGES.find((l) => l.id === lang());
  return `
    <header class="topbar">
      <span class="logo">Smarts</span>
      <span class="topbar-end">
        <button type="button" class="lang-btn" data-lang-open aria-haspopup="dialog" aria-label="${esc(t('lang.change'))}">${ICONS.globe}<span lang="${current.id}">${esc(current.name)}</span></button>
        ${withAvatar ? `<a href="#/progress" class="avatar-link" aria-label="${esc(t('home.yourProgress'))}">${avatar()}</a>` : ''}
      </span>
    </header>`;
}

/**
 * A new player's home: how the game works and one button. The Daily, duels and the tab bar
 * come after the first round; the avatar stays, for the account settings.
 */
function drawNewHome(firstName) {
  const quickTopics = CATEGORIES.filter((c) => !c.book && c.quick !== false).slice(0, TOPIC_PREVIEW);
  const friend = state.newFriend;
  app.innerHTML = `
    <section class="screen home home-new">
      ${homeTopbar()}
      <h1 class="greeting">${esc(t('home.hi', { name: firstName }))}</h1>
      ${duelAlerts()}
      ${howItWorks()}
      ${playCta(t('home.firstPlay'), t('home.firstPlaySub', { n: MODES[DEFAULT_MODE].questionsPerRound }))}
      ${friend ? homeRow({
        data: 'data-duel-friend', icon: ICONS.duel,
        title: t('home.duelFriend', { name: `<bdi>${esc(friend.name)}</bdi>` }), sub: esc(t('duel.cardDesc')),
      }) : ''}
      <h2 class="home-or">${esc(t('home.topics'))}</h2>
      <div class="topic-chips">
        ${quickTopics.map((c) => `<a class="topic-chip" href="#/play/${c.id}" style="--hue:${c.hue}">${ICONS[c.id]}<span>${esc(catName(c))}</span></a>`).join('')}
        <button type="button" class="topic-chip topic-chip-all" aria-controls="topic-list" aria-expanded="${topicsOpen}">
          <span>${esc(topicsOpen ? t('home.seeFewer') : t('home.seeAll', { n: CATEGORIES.length }))}</span>
        </button>
      </div>
      <ul class="topics" id="topic-list" ${topicsOpen ? '' : 'hidden'}>${topicRows(null)}</ul>
    </section>`;
  app.querySelector('[data-duel-friend]')?.addEventListener('click', () => {
    state.duelFriend = { id: friend.id, name: friend.name };
    go('#/duel/new');
  });
  app.querySelector('.topic-chip-all').addEventListener('click', (e) => {
    topicsOpen = !topicsOpen;
    const btn = e.currentTarget;
    const list = app.querySelector('#topic-list');
    list.hidden = !topicsOpen;
    btn.setAttribute('aria-expanded', String(topicsOpen));
    btn.firstElementChild.textContent = topicsOpen ? t('home.seeFewer') : t('home.seeAll', { n: CATEGORIES.length });
    if (topicsOpen) list.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  });
}

/** What's up next on the level ladder, under the level bar. */
function nextUnlockLine() {
  const next = nextUnlock(state.profile.level);
  if (!next) return `<span class="level-next">${esc(t('level.allUnlocked'))}</span>`;
  return `
    <span class="level-next">
      ${unlockPreview(next, 30)}
      <span>${esc(t('level.next', { n: next.level, item: t(`avatar.${next.part}.${next.value}`) }))}</span>
    </span>`;
}

/** The returning player's header: their avatar in its cover, the greeting and the level bar. */
function playerHero(firstName, streak) {
  return `
    <a class="player-hero" href="#/profile" aria-label="${esc(t('profile.edit'))}">
      <span class="player-hero-top">
        ${avatar(state.profile?.avatar, 76)}
        <span class="player-hero-hello">
          <h1 class="greeting">${esc(t('home.hi', { name: firstName }))}</h1>
          ${streak ? `<span class="sub">${ICONS.fire}${esc(tn('home.streak', streak))}</span>` : ''}
        </span>
      </span>
      ${levelBar()}
      ${nextUnlockLine()}
    </a>`;
}

function drawHome(firstName, stats, unlocked) {
  const streak = stats?.dayStreak || 0;
  app.innerHTML = `
    <section class="screen home has-tabbar">
      ${homeTopbar({ withAvatar: false })}
      ${unlocked ? `<p class="unlocked">${esc(t('home.unlocked'))}</p>` : ''}
      ${playerHero(firstName, streak)}
      ${duelAlerts()}
      ${playCta(t('home.quickPlay'), t('quick.desc', { n: MODES[DEFAULT_MODE].questionsPerRound }))}
      <div class="home-rows">
        ${dailyRow(state.daily)}
        ${levelingRow()}
        ${homeRow({ href: '#/duel/new', icon: ICONS.duel, title: esc(t('duel.cardTitle')), sub: esc(t('duel.cardDesc')) })}
      </div>
      <h2 class="section-title">${esc(t('home.topics'))}</h2>
      <ul class="topics ${topicsOpen ? '' : 'is-folded'}" id="topic-list">${topicRows(stats)}</ul>
      <button type="button" class="see-all" aria-controls="topic-list" aria-expanded="${topicsOpen}">
        <span>${esc(topicsOpen ? t('home.seeFewer') : t('home.seeAll', { n: CATEGORIES.length }))}</span>
        <span class="see-all-arrow" aria-hidden="true"></span>
      </button>
    </section>
    ${tabbar('home')}`;
  app.querySelector('.see-all').addEventListener('click', (e) => {
    topicsOpen = !topicsOpen;
    const btn = e.currentTarget;
    app.querySelector('#topic-list').classList.toggle('is-folded', !topicsOpen);
    btn.setAttribute('aria-expanded', String(topicsOpen));
    btn.firstElementChild.textContent = topicsOpen ? t('home.seeFewer') : t('home.seeAll', { n: CATEGORIES.length });
    // Bring the rows that just appeared into view, above the floating tab bar, so it's
    // clear something happened even on a short phone.
    const target = topicsOpen ? app.querySelector(`#topic-list > li:nth-child(${TOPIC_PREVIEW + 1})`) : app.querySelector('.section-title');
    target?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: topicsOpen ? 'center' : 'start' });
  });
}

async function showHome() {
  const firstName = esc(state.user.name.split(' ')[0]);
  // Once per visit, though the screen is drawn twice; a language change redraws without counting.
  if (!rerendering) {
    lastUnlocked = state.justUnlocked;
    state.justUnlocked = false;
    track('home_viewed', { variant: isNew() ? 'first' : 'returning' });
  }
  const draw = (stats) => {
    if (isNew()) drawNewHome(firstName);
    else drawHome(firstName, stats, lastUnlocked);
    app.querySelector('[data-lang-open]').addEventListener('click', (e) => openLangSheet(e.currentTarget));
  };
  const nav = navId;
  draw(state.stats);
  try {
    await pendingSave; // the duels list below must include a duel just finished, too
    // Always fresh: the numbers shown here change with every round, on any device.
    const [stats] = await Promise.all([
      loadStats(true),
      state.daily?.day === today() ? null : loadDaily().catch(() => null),
      api('/api/duels').then((r) => (state.duels = r.duels)).catch(() => null),
      loadStages().catch(() => null),
    ]);
    if (nav === navId) draw(stats);
  } catch (err) {
    if (err.status === 401) return signOut();
  }
}

// ── Round ──────────────────────────────────────────────────────

const roundTitle = (cat) =>
  cat === 'mixed' ? t('round.quick') : cat === 'review' ? t('round.review') : cat === 'daily' ? t('round.daily') : cat === 'duel' ? t('round.duel') : cat === 'stage' ? t('round.stage')
    : CATEGORY_BY_ID[cat] ? catName(CATEGORY_BY_ID[cat]) : cat;

const diffLevel = (d) => (d <= 3 ? 'easy' : d <= 6 ? 'medium' : 'hard');
/** "Hard · 8": how hard a question is, 0 to 10. */
const diffChip = (q) => (q.difficulty === undefined ? '' : `<span class="diff diff-${diffLevel(q.difficulty)}">${esc(t(`diff.${diffLevel(q.difficulty)}`))}</span>`);

/** What a question was about, for lists of answers: its own wording when the answer needs it, else its topic. */
const reviewLabel = (q) => (q.visual.type === 'text' || q.ownPrompt ? qt(q, q.prompt) : CATEGORY_BY_ID[q.cat] ? catName(CATEGORY_BY_ID[q.cat]) : '');

// Questions of the round played last in this visit, in case the server's stats lag behind.
let lastPlayedIds = new Set();

const recentIds = (stats) => new Set([...(stats?.lastRoundIds || []), ...lastPlayedIds]);

/**
 * Orders a pool for picking: new questions first, then ones you haven't mastered yet, then
 * mastered ones. Questions from the round just played always go last, so they only come back
 * when nothing else is left.
 */
function orderForPlay(pool, stats) {
  const seen = new Set(stats?.seenIds || []);
  const mastered = new Set(stats?.masteredIds || []);
  const recent = recentIds(stats);
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
  const pool = (cat === 'mixed' ? QUESTIONS.filter(inQuickRounds) : QUESTIONS.filter((q) => q.cat === cat))
    .filter((q) => !failedPictures.has(q.id));

  if (cat === 'mixed') {
    return pickLevel(pool, n, {
      seen: new Set(stats?.seenIds),
      known: new Set(stats?.knownIds),
      mastered: new Set(stats?.masteredIds),
      missed: new Set(stats?.dueMistakes),
      recent: recentIds(stats),
    });
  }

  const subjects = new Set();
  const picked = [];
  for (const q of orderForPlay(pool, stats)) {
    if (picked.length === n) break;
    if (subjects.has(subjectOf(q))) continue;
    subjects.add(subjectOf(q));
    picked.push(q);
  }
  return picked;
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
  await loadQuestions(candidates).catch(() => {}); // without their pictures' addresses they just count as failed
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
 * Plays a round. `fixed` plays a round the server runs (the Daily, a duel), one question at a time:
 * { kind, play: where it stands, title, after: where to go when done, endpoint and extra: how to end it early }.
 */
async function startRound(cat, fixed = null) {
  const nav = navId;
  const mode = DEFAULT_MODE;
  const cfg = MODES[mode];
  let stats = state.stats;
  // Review plays exactly what you've missed, so it always uses fresh stats. Other rounds use the
  // ones already loaded (lastPlayedIds covers a round whose save is still on its way).
  const needFresh = !fixed && cat === 'review';
  if (!fixed && (!stats || needFresh)) stats = await loadStats(needFresh).catch(() => stats);
  if (nav !== navId) return; // the player went somewhere else while stats loaded

  const round = {
    cat, mode, cfg, fixed,
    // In a Daily or duel, each question is a blank slot until the server opens it.
    questions: fixed ? Array.from({ length: fixed.play.total }, (_, slot) => ({ id: `play:${fixed.play.id}:${slot}`, slot })) : pickQuestions(cat, cfg.questionsPerRound, stats),
    comingBack: new Set(cat === 'mixed' ? stats?.dueMistakes : []), // past mistakes a Quick round may bring back
    idx: fixed?.play.idx ?? 0,
    results: [], // { q, choice, correct, ms, points, skipped }
    score: 0,
    streak: 0,
    bestStreak: 0,
    saved: false, // set once answers have been sent to the server
    swaps: 0, // questions replaced because their picture wouldn't load
    ended: false, // a Daily or duel the server has already finished
  };
  fixed?.play.results.forEach((r, i) => {
    round.results.push({ q: round.questions[i], choice: null, correct: r.correct, ms: 0, points: r.points, skipped: !!r.skipped });
    round.score += r.points;
  });
  if (!round.questions.length) return go('#/', { replace: true });
  if (!fixed) track('round_started', { mode, category: cat }); // the Daily and duels log theirs when the try starts

  const title = fixed?.title ?? roundTitle(cat);
  app.innerHTML = `
    <section class="screen play">
      <header class="play-top">
        <button class="icon-btn" data-quit aria-label="${esc(t('play.quit'))}">${ICONS.close}</button>
        <ol class="pips" aria-label="${esc(t('play.progress', { title }))}">
          ${round.questions.map((_, i) => {
            const r = round.results[i];
            return `<li${r ? ` class="${r.skipped ? 'is-skipped' : r.correct ? 'is-right' : 'is-wrong'}"` : ''}></li>`;
          }).join('')}
        </ol>
        <button class="auto-toggle" data-auto aria-haspopup="dialog" aria-expanded="false">
          <span class="auto-switch" aria-hidden="true"></span><span class="auto-label" data-auto-label></span>
        </button>
        <span class="play-score" aria-label="${esc(t('play.score'))}"><span data-score>${round.score}</span></span>
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
  let current = null; // { q, options, start, answered, outcome, preloaded, seconds, limitMs }
  let retryCall = null; // what the Retry button does after the connection to the server failed
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
    if (round.fixed && timing()) return; // the server's clock doesn't stop for a sheet, so this one doesn't either
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

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Calls the server about this round, trying again for a moment if the connection drops. */
  async function playCall(action, body) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await api(`/api/plays/${round.fixed.play.id}/${action}`, { method: 'POST', body });
      } catch (err) {
        if ((err.status && err.status < 500 && err.status !== 429) || attempt >= 3 || !alive) throw err;
        await wait(400 * 2 ** attempt);
      }
    }
  }

  /** A call failed: the round is over on the server (on to the result), or there's no connection (offer a retry). */
  function fixedTrouble(err, retry) {
    if (!alive) return;
    if (err.status === 409 || err.status === 404) {
      round.saved = true;
      round.ended = true;
      forgetOpenRound();
      state.stats = null;
      return leave(round.fixed.after);
    }
    retryCall = retry;
    showDock(`<p class="dock-msg is-wrong">${esc(errMsg(err))}</p><button class="btn btn-marigold btn-next" data-retry><span>${esc(t('res.retry'))}</span></button>`);
  }

  /** Pictures the server says can be downloaded now, for slots that haven't been played. */
  function usePreviews(list) {
    for (const { idx, visual } of list || []) {
      const slot = round.questions[idx];
      if (slot?.slot === undefined) continue;
      slot.visual ??= visual;
      if (idx > round.idx) preload(slot);
    }
  }

  /** A question has been answered or skipped: the slot becomes the real question. */
  function useResult(r, token) {
    learn({ q: r.question });
    const real = QUESTION_BY_ID.get(r.question.id) || r.question;
    round.questions[r.idx] = real;
    if (token) token.q = real;
    if (r.finished) round.ended = true;
    usePreviews(r.previews);
    return real;
  }

  /** Waits until the player is here to see it, then opens the question, which starts the server's clock. */
  async function openFixed(token) {
    while ((document.hidden || pausedAt) && alive && current === token) await wait(200);
    if (!alive || current !== token) return false;
    let opened;
    try {
      opened = await playCall('open', { idx: round.idx });
    } catch (err) {
      fixedTrouble(err, showQuestion);
      return false;
    }
    if (!alive || current !== token) return false;
    const q = token.q;
    Object.assign(q, { cat: opened.cat, prompt: opened.prompt, visual: q.visual ?? opened.visual });
    token.options = opened.options;
    token.seconds = opened.seconds;
    token.limitMs = opened.seconds * 1000;
    token.remainingMs = opened.remainingMs;
    return true;
  }

  async function showQuestion() {
    const q = round.questions[round.idx];
    current = { q, options: [], start: 0, answered: false, outcome: null, preloaded: false, seconds: 0, limitMs: 0, remainingMs: null };
    const token = current;
    // Nothing to download for this one: its words come first, so the screen changes all at once.
    if (round.fixed && !q.visual && !(await openFixed(token))) return;
    if (!round.fixed) {
      token.options = shuffle(q.options);
      token.seconds = secondsFor(q, cfg);
      token.limitMs = token.seconds * 1000;
    }
    const seconds = token.seconds || cfg.secondsPerQuestion;
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
    const typed = round.fixed?.kind === 'stage';
    const bidi = typed ? ' dir="auto"' : '';
    const head =
      q.visual.type === 'text'
        ? `<div class="qcard" style="--hue:${typed ? 'var(--cobalt)' : topic.hue}">
             <p class="qcard-source"${bidi}>${esc(typed ? round.fixed.title : topic.book ? t('q.byAuthor', { topic: catName(topic), author: catBlurb(topic) }) : catName(topic))}</p>
             <p class="qcard-text" id="prompt"${bidi}>${esc(qt(q, q.prompt))}</p>
           </div>`
        : `<figure class="pic pic-${q.visual.type}">${vis.html}<p class="pic-loading" hidden>${esc(t('q.loading'))}</p></figure>
           <p class="prompt" id="prompt"${bidi}>${esc(qt(q, q.prompt))}</p>`;
    // Options are kept in English (that's what is graded) and shown translated.
    // A new player's very first question says what to do. The clock isn't paused for it,
    // so a first Daily or duel scores the same as anyone's.
    const firstHint = isNew() && round.idx === 0 ? `<p class="first-hint">${esc(t('play.firstHint'))}</p>` : '';
    const retryChip = round.comingBack.has(q.id) ? `<p class="retry-chip">${esc(t('play.retry'))}</p>` : '';
    stage.innerHTML = `
      ${retryChip}
      ${head}
      ${firstHint}
      <div class="answers is-waiting" role="group" aria-labelledby="prompt">
        ${(token.options.length ? token.options : Array(5).fill('')).map((o, i) => `<button class="answer" data-i="${i}" disabled><kbd>${i + 1}</kbd><span${bidi}>${esc(qt(q, o))}</span></button>`).join('')}
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

    if (!ok && round.fixed) {
      try {
        useResult(await playCall('skip', { idx: round.idx }), token);
      } catch (err) {
        return fixedTrouble(err, showQuestion);
      }
      if (!alive || current !== token) return;
    }

    fuseRow.classList.remove('is-waiting');
    if (!ok) {
      // The picture failed or is too slow: offer a skip that doesn't count.
      const pic = stage.querySelector('.pic .vis');
      if (pic) pic.outerHTML = `<div class="vis vis-photo">${missingHtml()}</div>`;
      current.answered = true;
      current.outcome = 'skipped';
      round.results.push({ q: token.q, choice: null, correct: false, ms: 0, points: 0, skipped: true });
      keepOpenRound();
      pips[round.idx].classList.add('is-skipped');
      showDock(`<p class="dock-msg">${esc(t('q.noPicture'))}</p>${reportBtn(token.q)}<button class="btn btn-marigold btn-next" data-next><span>${esc(t('q.skip'))}</span></button>`);
      scheduleAutoNext();
      return;
    }

    // Now the picture is on screen, the server can start the clock and send the words.
    if (round.fixed && !token.options.length) {
      if (!(await openFixed(token))) return;
      stage.querySelector('#prompt').textContent = qt(q, q.prompt);
      stage.querySelectorAll('.answer span').forEach((s, i) => { s.textContent = qt(q, token.options[i]); });
      secsEl.textContent = token.seconds;
    }

    // Options appear together with the picture, so nobody gets a head start reading them.
    stage.querySelector('.answers').classList.remove('is-waiting');
    stage.querySelectorAll('.answer').forEach((b) => (b.disabled = false));
    current.start = performance.now();
    if (token.remainingMs !== null) current.start -= token.limitMs - token.remainingMs; // opened earlier: its clock kept running
    // Left the app while the server was opening it: its clock has started, so it counts as left.
    if (pausedAt && round.fixed) return void answer(null, { away: true });
    if (pausedAt) {
      // Went to the background while the picture loaded: start paused and hidden.
      pausedAt = current.start;
      pause({ hide: document.hidden });
    } else {
      raf = requestAnimationFrame(tick);
    }
  }

  /** `away`: the player left the app while the question was on screen, so it counts as wrong. */
  function answer(choice, { away = false } = {}) {
    if (!timing() || (pausedAt && !away)) return;
    current.answered = true;
    cancelAnimationFrame(raf);
    const token = current;
    if (round.fixed) {
      // The server decides: until it does, the tap shows and the clock stops.
      stage.querySelectorAll('.answer').forEach((b) => {
        b.disabled = true;
        if (token.options[Number(b.dataset.i)] === choice) b.classList.add('is-picked');
      });
      fuseRow.classList.add('is-done');
      submitFixed(token, choice, away);
      return;
    }
    const { q } = token;
    const ms = Math.round((pausedAt || performance.now()) - token.start);
    const correct = choice === q.answer;
    reveal(token, { choice, away, correct, ms, points: pointsFor(correct, ms, token.seconds) });
  }

  async function submitFixed(token, choice, away) {
    let r;
    try {
      r = await playCall('answer', { idx: round.idx, choice });
    } catch (err) {
      return fixedTrouble(err, () => { dock.hidden = true; submitFixed(token, choice, away); });
    }
    if (!alive || current !== token) return;
    useResult(r, token);
    reveal(token, { choice, away, correct: r.correct, ms: r.ms, points: r.points });
  }

  /** Shows how a question went. */
  function reveal(token, { choice, away, correct, ms, points }) {
    const { q } = token;

    round.score += points;
    round.streak = correct ? round.streak + 1 : 0;
    round.bestStreak = Math.max(round.bestStreak, round.streak);
    round.results.push({ q, choice, correct, ms, points, skipped: false, away });
    keepOpenRound();

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
    if (sheetOpen()) pause(); // its time ran out behind a sheet: the next question waits for it to close
    preload(nextQuestion()); // no-op if it's already cached

    // Short answers stay on one line ("No U-turn" shouldn't split); long ones wrap.
    const shown = qt(q, q.answer);
    const long = shown.length > 22;
    const ans = `<b class="${long ? 'is-long' : ''}"${q.cat === 'stage' ? ' dir="auto"' : ''}>${esc(shown)}</b>`;
    const reveal = t(long ? 'q.answerIs' : 'q.its', { answer: ans });
    const msg = correct
      ? `<p class="dock-msg is-right">${ICONS.check}<span>${t('q.right', { points })}</span></p>`
      : away
        ? `<p class="dock-msg is-wrong">${ICONS.cross}<span>${esc(t('q.away'))} ${reveal}</span></p>`
      : choice === null
        ? `<p class="dock-msg is-wrong">${ICONS.clock}<span>${esc(t('q.outOfTime'))} ${reveal}</span></p>`
        : `<p class="dock-msg is-wrong">${ICONS.cross}<span>${reveal}</span></p>`;
    const last = round.idx === round.questions.length - 1;
    showDock(`${msg}${reportBtn(q)}<button class="btn btn-marigold btn-next" data-next><span>${esc(t(last ? 'q.seeResults' : 'q.next'))}</span></button>`);

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
    if (!current?.outcome || pausedAt || !autoNextOn()) return;
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
    pause({ hide: true }); // the clock stops, so the question can't be read meanwhile
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
    if (!alive || pausedAt || !current?.outcome) return;
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

  // A copy of the round on this device while it's on, so a round the phone closed without
  // warning (no pagehide, e.g. killed in the background) is finished on the next visit.
  function keepOpenRound() {
    if (round.saved) return; // already ended (closing the page can still fire the "left the app" answer)
    // All the server needs to end a Daily or duel; the answers it has already.
    if (round.fixed) return storeOpenRound({ fixed: { endpoint: round.fixed.endpoint, extra: round.fixed.extra } });
    storeOpenRound({
      cat: round.cat, mode: round.mode,
      ids: round.questions.map((q) => q.id),
      answers: answersPayload(round.results),
      skipped: round.results.filter((r) => r.skipped).map((r) => r.q.id),
    });
  }

  /**
   * However a round is left (Leave in the quit sheet, closing the site), it ends as a finished
   * round: every question not answered yet, the one on screen included, counts as wrong.
   * Questions whose picture didn't load stay out, as in a round played to the end.
   */
  function addUnanswered() {
    const done = new Set(round.results.map((r) => r.q.id));
    for (const q of round.questions) {
      if (!done.has(q.id)) round.results.push({ q, choice: null, correct: false, ms: secondsFor(q, cfg) * 1000, points: 0, skipped: false, left: true });
    }
  }

  async function finish() {
    if (round.saved) return; // already ended (e.g. closed, then shown again from the back-forward cache)
    const record = { ...round, saved: null, error: null, payload: answersPayload(round.results) };
    round.saved = true;
    forgetOpenRound();
    rememberPlayed();
    if (round.fixed || record.payload.length) countFinished(); // a round of only skips isn't saved
    if (round.fixed) {
      const saving = round.ended ? roundEnded() : endFixed(round.fixed); // started first, so the next screen can wait for it
      leave(round.fixed.after);
      return saving;
    }
    state.lastRound = record;
    leave('#/results');
    await saveRecord(record);
  }

  /** The page is closing mid-round: finish it with what's left counted wrong, in a beacon that outlives the page. */
  function finishOnClose() {
    if (round.saved) return;
    if (round.fixed) {
      round.saved = true;
      forgetOpenRound();
      rememberPlayed();
      countFinished();
      if (!round.ended) endFixed(round.fixed, { beacon: true });
      return;
    }
    addUnanswered();
    const record = { ...round, payload: answersPayload(round.results) };
    round.saved = true;
    forgetOpenRound();
    rememberPlayed();
    if (!record.payload.length) return;
    countFinished();
    state.stats = null;
    const body = JSON.stringify({ mode: round.mode, category: round.cat, answers: record.payload });
    if (navigator.sendBeacon?.('/api/rounds', new Blob([body], { type: 'application/json' }))) return;
    fetch('/api/rounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }

  function openQuit() {
    if (!autoSheet.hidden) closeAuto();
    const answered = new Set(round.results.map((r) => r.q.id));
    const left = round.questions.filter((q) => !answered.has(q.id)).length;
    $('[data-quit-note]').textContent = round.fixed
      ? tn({ daily: 'quit.daily', stage: 'quit.stage' }[round.fixed.kind] ?? 'quit.duel', left)
      : tn('quit.note', left);
    pause({ hide: true }); // the clock stops, so the question can't be read meanwhile
    quitSheet.hidden = false;
    quitSheet.querySelector('[data-keep]').focus();
  }

  function closeQuit() {
    quitSheet.hidden = true;
    if (!document.hidden) resume();
  }

  function confirmQuit() {
    // Ends the round here, like playing it out without answering: the results show it.
    quitSheet.hidden = true;
    addUnanswered();
    finish();
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
    if (document.hidden) {
      // Leaving the app with a question on screen (another app, the lock button, another tab)
      // makes it count as wrong, so time away can't go into looking the answer up. Between
      // questions, the round just waits.
      if (timing()) answer(null, { away: true });
      pause({ hide: true });
    } else if (!sheetOpen()) resume();
  };

  const onPageHide = () => finishOnClose();
  // Shown again from the back-forward cache after the close already ended the round: move on.
  const onPageShow = (e) => { if (e.persisted && round.saved && alive) leave(round.fixed?.after ?? '#/'); };

  const onClick = (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.classList.contains('answer')) return current && answer(current.options[Number(t.dataset.i)]);
    if (t.hasAttribute('data-next')) return next();
    if (t.hasAttribute('data-retry')) return retryCall?.();
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
  window.addEventListener('pageshow', onPageShow);
  cleanup = () => {
    // Moved to another screen without finishing (a link, a notification): the round ends here too.
    if (!round.saved) finishOnClose();
    alive = false;
    cancelAnimationFrame(raf);
    clearTimeout(advanceTimer);
    app.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    // Keep listening until the guard pop has been handled.
    if (!leavingTo) window.removeEventListener('popstate', onPopState);
    else {
      const original = onPopState;
      window.removeEventListener('popstate', original);
      window.addEventListener('popstate', () => { if (leavingTo) original(); }, { once: true });
    }
  };

  keepOpenRound();
  if (fixed) {
    usePreviews(fixed.play.previews);
    preload(round.questions[round.idx]);
    showQuestion();
    return;
  }
  // The screen is up; the questions of the round follow in one request.
  loadQuestions(round.questions).then(() => {
    if (!alive) return;
    round.questions.slice(0, 3).forEach(preload);
    showQuestion();
  }, (err) => {
    if (!alive) return;
    round.saved = true; // nothing was played
    forgetOpenRound();
    window.alert(errMsg(err));
    leave('#/');
  });
}

// ── Rounds left without warning ─────────────────────────────────

const openRoundKey = () => `smarts:${state.user.id}:openRound`;

function storeOpenRound(r) {
  try { localStorage.setItem(openRoundKey(), JSON.stringify(r)); } catch { /* storage blocked: closing still sends a beacon */ }
}

function forgetOpenRound() {
  try { localStorage.removeItem(openRoundKey()); } catch { /* storage blocked */ }
}

// Quick and topic rounds whose save failed, kept apart from the open round so playing on can't
// replace them. Never the Daily or duels: other players see those scores, and a copy kept on the
// device can be edited.
const MAX_UNSENT = 20;
const unsentKey = () => `smarts:${state.user.id}:unsentRounds`;

function unsentRounds() {
  try { return JSON.parse(localStorage.getItem(unsentKey()) || '[]'); } catch { return []; }
}

function storeUnsent(list) {
  try { localStorage.setItem(unsentKey(), JSON.stringify(list)); } catch { /* storage blocked: Retry on screen still works */ }
}

/** No connection, a server hiccup or an expired session. Anything else is a refusal, and sending it again won't help. */
const mightSaveLater = (err) => !err.status || err.status >= 500 || err.status === 429 || err.status === 401;

function keepUnsent(record, body) {
  record.unsentId ??= String(Date.now());
  storeUnsent([...unsentRounds().filter((u) => u.id !== record.unsentId), { id: record.unsentId, body }].slice(-MAX_UNSENT));
}

function forgetUnsent(record) {
  if (record.unsentId) storeUnsent(unsentRounds().filter((u) => u.id !== record.unsentId));
}

/** Sends rounds that failed to save earlier. */
async function sendUnsent() {
  const rounds = unsentRounds();
  if (!rounds.length) return;
  storeUnsent([]);
  const kept = [];
  for (const r of rounds) {
    try {
      await api('/api/rounds', { method: 'POST', body: r.body });
      state.stats = null;
    } catch (err) {
      if (mightSaveLater(err)) kept.push(r);
    }
  }
  if (kept.length) storeUnsent(kept);
}

/**
 * Runs when the app opens: sends rounds that failed to save, then finishes a round this device
 * still has open (the phone closed the app before it could end it), with the questions never
 * answered counted wrong.
 */
async function finishLeftRound() {
  await sendUnsent();
  let r = null;
  try { r = JSON.parse(localStorage.getItem(openRoundKey()) || 'null'); } catch { /* unreadable: drop it */ }
  forgetOpenRound();
  if (r?.fixed) {
    // A Daily or duel: the server knows what was answered, so this only tells it the round is over.
    try {
      await api(r.fixed.endpoint, { method: 'POST', body: r.fixed.extra });
      countFinished();
      state.stats = null;
    } catch (err) {
      if (mightSaveLater(err)) storeOpenRound({ fixed: r.fixed });
    }
    return;
  }
  if (!r?.ids?.length) return;
  const cfg = MODES[r.mode] || MODES[DEFAULT_MODE];
  const done = new Set([...(r.answers || []).map((a) => a.id), ...(r.skipped || [])]);
  const answers = [
    ...(r.answers || []),
    ...r.ids.filter((id) => !done.has(id) && QUESTION_BY_ID.has(id)).map((id) => ({ id, choice: null, ms: secondsFor(QUESTION_BY_ID.get(id), cfg) * 1000 })),
  ];
  if (!answers.length) return;
  try {
    await api('/api/rounds', { method: 'POST', body: { mode: r.mode, category: r.cat, answers } });
    countFinished();
    state.stats = null;
  } catch (err) {
    // No connection or a server hiccup: keep it for next time. A refusal (e.g. the Daily was
    // already finished on another device) means there's nothing left to save.
    if (!err.status || err.status >= 500 || err.status === 429) storeOpenRound(r);
  }
}

async function saveRecord(record) {
  if (!record.payload.length) return;
  record.error = null;
  const body = { mode: record.mode, category: record.cat, answers: record.payload };
  const saving = api('/api/rounds', { method: 'POST', body });
  pendingSave = saving.catch(() => {});
  try {
    record.saved = await saving;
    applyXp(record.saved.xp);
    forgetUnsent(record);
    loadStats(true).catch(() => {});
  } catch (err) {
    record.error = err.status === 401 ? t('save.signedOut') : errMsg(err);
    if (mightSaveLater(err)) keepUnsent(record, body);
  }
  if (location.hash === '#/results' && state.lastRound === record) showResults();
}

// ── Results ────────────────────────────────────────────────────

/**
 * One row of a list of answers: the picture with a right/wrong badge, what the player said,
 * the answer and the points. `x` is { q, choice, correct, ms, points, skipped }. `mixed` names
 * each row's topic; `reportIndex` adds a report button for that answer.
 */
function answerRow(x, { mixed = true, reportIndex = null } = {}) {
  const q = x.q;
  const outcome = x.skipped ? 'skipped' : x.correct ? 'right' : x.choice ? 'wrong' : x.left ? 'left' : x.away ? 'away' : 'timeout';
  const pic = thumb(q);
  const hue = CATEGORY_BY_ID[q.cat]?.hue;
  const label = q.visual.type === 'text' || q.ownPrompt || mixed ? reviewLabel(q) : '';
  const answer = t('res.answer', { answer: `<bdi>${esc(qt(q, q.answer))}</bdi>` });
  const lines = {
    right: `<strong>${answer}</strong><span class="review-time">${esc(t('res.secondsShort', { s: (x.ms / 1000).toFixed(1) }))}</span>`,
    wrong: `<span class="review-you">${t('res.you', { choice: `<bdi>${esc(qt(q, x.choice))}</bdi>` })}</span><strong>${answer}</strong>${diffChip(q)}`,
    timeout: `<span class="review-you">${esc(t('res.timeout'))}</span><strong>${answer}</strong>${diffChip(q)}`,
    left: `<span class="review-you">${esc(t('res.left'))}</span><strong>${answer}</strong>`,
    away: `<span class="review-you">${esc(t('res.away'))}</span><strong>${answer}</strong>`,
    skipped: `<strong>${answer}</strong><span>${esc(t('res.skipped'))}</span>`,
  };
  const said = { right: tn('res.srRight', x.points), wrong: t('res.srWrong'), timeout: t('res.timeout'), left: t('res.left'), away: t('res.away'), skipped: t('res.srSkipped') }[outcome];
  const pill = x.skipped ? '' : `<span class="pts-pill ${!x.correct ? 'is-wrong' : x.points >= MAX_POINTS ? 'is-fast' : 'is-right'}" dir="ltr" aria-hidden="true">${x.correct ? `+${x.points}` : '0'}</span>`;
  return `
    <li class="is-${outcome}">
      <span class="review-thumb" style="--hue:${hue}">
        ${ICONS[q.cat] || ''}${pic || ''}
        <span class="review-mark" aria-hidden="true">${x.skipped ? '–' : x.correct ? ICONS.check : ICONS.cross}</span>
      </span>
      <span class="review-text">
        <span class="sr-only">${esc(said)}.</span>
        ${label ? `<span class="review-q">${esc(label)}</span>` : ''}
        ${lines[outcome]}
      </span>
      ${pill}
      ${reportIndex === null ? '' : `<button class="review-report" data-report-i="${reportIndex}" aria-label="${esc(t('report.button'))}" title="${esc(t('report.button'))}">${ICONS.report}</button>`}
    </li>`;
}

/** A thumbnail that doesn't load leaves the topic icon underneath. */
function bindThumbs() {
  app.querySelectorAll('.review-thumb img').forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
}

function showResults() {
  const r = state.lastRound;
  const counted = r.results.filter((x) => !x.skipped);
  const right = counted.filter((x) => x.correct).length;
  const max = counted.length * MAX_POINTS;
  const bonus = r.score - right; // 1 point per right answer; the rest came from speed
  const title = roundTitle(r.cat);
  const topic = CATEGORY_BY_ID[r.cat];
  const verdict = t(
    !counted.length ? 'res.none'
      : right === counted.length ? 'res.perfect'
      : right >= counted.length * 0.8 ? 'res.sharp'
        : right >= counted.length * 0.5 ? 'res.solid'
          : 'res.learn',
  );
  // In a Quick or Review round each row says which topic it was from; in a topic round they all are.
  const mixed = !topic;
  // The player's first finished round just unlocked the Daily and duels (see countFinished).
  const firstRound = state.played === 1 && state.justUnlocked;

  app.innerHTML = `
    <section class="screen results">
      ${topbar()}

      <div class="score-hero">
        <p class="eyebrow on-cobalt">${esc(title)}</p>
        <p class="score-big"><bdi dir="ltr">${r.score}<small>/${max}</small></bdi></p>
        <p class="score-unit">${esc(t('res.points'))}</p>
        <p class="score-line">${t('res.right', { right, total: counted.length })} ${esc(verdict)}</p>
        ${counted.length ? `
          <div class="score-squares" role="img" aria-label="${esc(t('res.squaresAria', { right, total: counted.length }))}">${squaresHtml(r.results.map((x) => squareFor(x.skipped ? null : x.points)))}</div>
          <dl class="score-sum">
            <div><dt>${esc(tn('res.rightAnswers', right))}</dt><dd><bdi dir="ltr">+${right}</bdi></dd></div>
            <div><dt>${esc(t('res.speedBonus'))}</dt><dd><bdi dir="ltr">+${bonus}</bdi></dd></div>
          </dl>
          <p class="score-how">${esc(t('res.howPoints', { max: MAX_POINTS - 1 }))}</p>
          ${r.bestStreak >= 3 ? `<p class="score-how">${esc(t('res.streak', { n: r.bestStreak }))}</p>` : ''}` : ''}
        ${r.saved?.xpGained ? `
          <div class="xp-row">
            <p class="xp-earned" dir="ltr">+${r.saved.xpGained} XP</p>
            ${levelBar()}
          </div>` : ''}
        <p class="save-state ${r.error ? 'is-error' : ''}">
          ${esc(r.error ? t('res.notSaved', { error: r.error }) : r.saved ? t('res.saved') : counted.length ? t('res.saving') : '')}
        </p>
        ${r.error ? `<button class="btn btn-ghost" data-retry>${esc(t('res.retry'))}</button>` : ''}
      </div>

      <div class="results-actions">
        <a class="btn btn-marigold btn-block" href="#/play/${r.cat}" data-again>${esc(topic ? t('res.againTopic', { topic: catName(topic) }) : t('res.again'))}</a>
        <a class="btn btn-ghost btn-block" href="#/">${esc(t('res.back'))}</a>
      </div>

      ${firstRound ? `
        <div class="panel unlocked-card">
          <span class="daily-badge">${ICONS.daily}</span>
          <h2>${esc(t('res.newDaily'))}</h2>
          <p>${esc(t('daily.rowDesc'))}</p>
          <a class="btn btn-ghost-ink btn-block" href="#/daily">${esc(t('daily.start'))}</a>
          <a class="unlocked-link" href="#/duel/new">${esc(t('duel.cardTitle'))}</a>
        </div>` : ''}

      <h2 class="section-title" id="answers-title">${esc(t('res.yourAnswers'))}</h2>
      <ol class="review" aria-labelledby="answers-title">${r.results.map((x, i) => answerRow(x, { mixed, reportIndex: i })).join('')}</ol>
    </section>`;

  bindThumbs();

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

/**
 * A player's avatar in the cover of their level, with the number on it. The cover hangs around
 * the avatar without taking up room beside it, so hidden players (no level) still line up.
 */
function coveredAvatar(player, size = 40) {
  const level = player?.level;
  if (!level) return avatarImg(player?.avatar, size);
  const tier = tierFor(level).id;
  return `<span class="cover is-${tier}" style="--s:${size}px" role="img" aria-label="${esc(t('level.label', { n: level }))}">${avatarImg(player.avatar, size)}<img class="cover-art" src="${coverUrl(tier)}" alt=""><span class="cover-num" aria-hidden="true">${level}</span></span>`;
}

/** The player's own avatar with an unlockable part swapped in: a creature, a face, a colour or an extra. */
const unlockPreview = (u, size) => avatarImg(avatarCode({ ...parseAvatar(state.profile.avatar), [u.part]: u.value }), size);

/** "Level 12 · Silver", the player's XP through that level, and a bar. */
function levelBar() {
  const { level, into, need } = levelProgress(state.profile.xp);
  return `
    <span class="level-bar">
      <span class="level-bar-top">
        <strong>${esc(t('level.label', { n: level }))} · ${esc(t(`level.tier.${tierFor(level).id}`))}</strong>
        ${need ? `<span dir="ltr">${into}/${need} XP</span>` : ''}
      </span>
      <span class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${need || 1}" aria-valuenow="${need ? into : 1}" aria-label="${esc(t('level.label', { n: level }))}"><span style="width:${need ? (into / need) * 100 : 100}%"></span></span>
    </span>`;
}

/** "+48 XP", for result screens of Daily and duel rounds. */
const xpEarned = (category, score) => (score > 0 ? `<p class="xp-earned xp-earned-ink" dir="ltr">+${xpForRound(category, score)} XP</p>` : '');

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
    ${topbarStart()}
    <a href="#/progress" class="avatar-link" aria-label="${esc(t('home.yourProgress'))}">${avatar()}</a>
  </header>`;

/** A note under share buttons: "Copied", "Saved"… */
function shareStatus(el, result) {
  const key = { copied: 'share.copied', saved: 'share.saved', failed: 'share.failed' }[result];
  el.textContent = key ? t(key) : '';
}

// ── Fixed rounds (the Daily and duels) ─────────────────────────

/** Plays a round the server runs: { kind: 'daily'|'duel', play, title, after, endpoint, extra }. */
function playFixed(fixed) {
  state.fixedRound = fixed;
  go(`#/play/${fixed.kind}`);
}

/** The server has the round's result: the next screen and the stats can read it. */
function roundEnded() {
  state.stats = null;
  pendingSave = loadStats(true).then(() => {}, () => {});
  return pendingSave;
}

/** Tells the server a Daily or duel is over early. Whatever wasn't answered counts as wrong. */
function endFixed(fixed, { beacon = false } = {}) {
  if (beacon && navigator.sendBeacon) {
    state.stats = null;
    navigator.sendBeacon(fixed.endpoint, new Blob([JSON.stringify(fixed.extra)], { type: 'application/json' }));
    return Promise.resolve();
  }
  pendingSave = api(fixed.endpoint, { method: 'POST', body: fixed.extra })
    .catch((err) => { if (mightSaveLater(err)) storeOpenRound({ fixed: { endpoint: fixed.endpoint, extra: fixed.extra } }); })
    .then(() => { state.stats = null; loadStats(true).catch(() => {}); });
  return pendingSave;
}

// ── Daily Challenge ────────────────────────────────────────────

const today = () => localDate(new Date().getTimezoneOffset());

async function loadDaily() {
  state.daily = await api(`/api/daily?date=${today()}`);
  learn(state.daily.questions);
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
      ${isNew() ? howItWorks() : ''}
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
        play: r.play, endpoint: '/api/daily/finish', extra: { date: d.day },
      });
    } catch (err) {
      e.currentTarget.disabled = false;
      window.alert(errMsg(err));
    }
  });
}

const boardRows = (entries) => `<ol class="board">${entries.map((e) => `
    <li class="${e.me ? 'is-me' : ''}">
      <span class="board-rank ${e.rank >= 1000 ? 'is-long' : ''}">${e.rank}</span>
      ${coveredAvatar(e, 40)}
      <span class="board-who">${personName(e)}<small>${esc(t('board.right', { c: e.correct, t: e.total }))}</small></span>
      <span class="board-pts">${e.score}</span>
    </li>`).join('')}</ol>`;

/** What a board shows with `limit` rows open: those rows, the viewer's neighbours below them, and whether any row is still out of sight. */
function boardView({ entries, around, limit }) {
  const open = entries.slice(0, limit);
  const lastRank = open.at(-1)?.rank ?? 0;
  const below = around.filter((e) => e.rank > lastRank);
  const belowRanks = new Set(below.map((e) => e.rank));
  return { open, below, more: entries.slice(limit).some((e) => !belowRanks.has(e.rank)) };
}

/** One board: its first rows, then the viewer and their neighbours if they're further down, then a button. `total` is how many players the rows came from. */
function boardHtml(board) {
  const { entries, limit, total, emptyHtml } = board;
  if (!entries.length) return `<p class="board-empty">${emptyHtml}</p>`;
  const { open, below, more } = boardView(board);
  const nextRank = entries[limit]?.rank ?? open.at(-1).rank + 1;
  const skipped = below.length > 0 && below[0].rank !== nextRank;
  const button = more ? 'board.more' : limit > BOARD.first ? 'board.fewer' : '';
  return `
    ${boardRows(open)}
    ${skipped ? '<p class="board-gap">…</p>' : ''}
    ${below.length ? boardRows(below) : ''}
    ${total > open.length ? `<p class="board-note">${esc(t('board.topOf', { shown: open.length, players: total }))}</p>` : ''}
    ${button ? `<button type="button" class="btn btn-ghost-ink btn-block board-more" data-board-more>${esc(t(button))}</button>` : ''}`;
}

/** The player and the friends just above and below them. */
function aroundMe(entries) {
  const i = entries.findIndex((e) => e.me);
  return i < 0 ? [] : entries.slice(Math.max(0, i - BOARD.around), i + BOARD.around + 1);
}

let boardTab = 'all';

function drawDailyResult(d, board) {
  const r = d.result;
  const finished = !!r.finished;
  const max = d.count * MAX_POINTS;
  const squares = squaresFor(d.questionIds || [], r.answers || []);
  const me = board?.me;
  const answered = new Map((r.answers || []).map((a) => [a.id, a]));
  app.innerHTML = `
    <section class="screen daily has-tabbar">
      ${topbar()}
      <p class="eyebrow on-cobalt">${esc(t('daily.title', { n: d.number }))}</p>
      ${finished ? `
        <div class="panel result-card">
          ${avatar(state.profile?.avatar, 64)}
          <p class="result-score">${r.score}<small>/${max}</small></p>
          <p class="result-line">${esc(t('daily.rightOf', { right: r.correct ?? 0, total: d.count }))}${me ? ` · ${esc(t('daily.rank', { rank: me.rank, players: board.players }))}` : ''}</p>
          ${xpEarned('daily', r.score)}
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
        <div data-board></div>
      </div>

      ${finished ? `
        <h2 class="section-title" id="answers-title">${esc(t('res.yourAnswers'))}</h2>
        <ol class="review" aria-labelledby="answers-title">
          ${d.questionIds.map((id) => QUESTION_BY_ID.get(id)).filter(Boolean).map((q) => {
            const a = answered.get(q.id);
            return answerRow({ q, choice: a?.choice ?? null, correct: !!a?.correct, ms: a?.ms ?? 0, points: a ? pointsOf(a) : 0, skipped: !a });
          }).join('')}
        </ol>` : ''}
    </section>
    ${tabbar('home')}`;

  bindThumbs();
  // Only the open tab is drawn, and only as many rows as the player asked to see.
  const boards = {
    all: { entries: board?.top || [], around: board?.around || [], total: board?.players ?? 0, emptyHtml: esc(t('board.noneYet')) },
    friends: { entries: board?.friends || [], around: aroundMe(board?.friends || []), total: 0, emptyHtml: `${esc(t('board.noFriends'))} <a href="#/friends">${esc(t('board.invite'))}</a>` },
  };
  const limits = { all: BOARD.first, friends: BOARD.first };
  const boardEl = app.querySelector('[data-board]');
  const drawBoard = () => { boardEl.innerHTML = boardHtml({ ...boards[boardTab], limit: limits[boardTab] }); };
  drawBoard();
  app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    boardTab = b.dataset.tab;
    app.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    drawBoard();
  }));
  boardEl.addEventListener('click', (e) => {
    if (!e.target.closest('[data-board-more]')) return;
    const growing = boardView({ ...boards[boardTab], limit: limits[boardTab] }).more;
    limits[boardTab] = growing ? limits[boardTab] + BOARD.step : BOARD.first;
    drawBoard();
    boardEl.querySelector('[data-board-more]')?.focus({ preventScroll: true });
    if (!growing) boardEl.closest('.panel').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  });
  if (!finished) return;

  const status = app.querySelector('[data-share-status]');
  const url = `${location.origin}/daily?l=${lang()}`;
  const text = `${t('daily.shareText', { n: d.number, score: r.score, max, right: r.correct ?? 0, total: d.count })}\n${squares.join('')}`;
  app.querySelector('[data-share]').addEventListener('click', async () => shareStatus(status, await shareText({ text, url })));
  app.querySelector('[data-copy]').addEventListener('click', async () => shareStatus(status, (await copyText(`${text}\n${url}`)) ? 'copied' : 'failed'));
  app.querySelector('[data-story]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const blob = await resultImage({
        heading: t('daily.title', { n: d.number }), score: r.score, max, squares, name: state.profile.name, avatar: state.profile.avatar,
        lines: [t('daily.rightOf', { right: r.correct ?? 0, total: d.count }), me ? t('daily.rank', { rank: me.rank, players: board.players }) : ''].filter(Boolean),
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
  const { play } = await api(`/api/duels/${id}/start`, { method: 'POST' });
  track('round_started', { mode: DEFAULT_MODE, category: 'duel' });
  playFixed({
    kind: 'duel', title: t('duel.title'), after: `#/duel/${id}`,
    play, endpoint: `/api/duels/${id}/finish`, extra: {},
  });
}

const duelTopic = (category) => (category === 'mixed' ? t('duel.mixed') : CATEGORY_BY_ID[category] ? catName(CATEGORY_BY_ID[category]) : category);

/** The other player in a duel, from the viewer's side. */
const duelOther = (d) => (d.role === 'challenger' ? d.opponent || d.invitedFriend : d.challenger);

/** Pick the questions for a new duel: a mix, or one topic. */
function showDuelNew() {
  const friend = state.duelFriend;
  const friendName = friend && `<bdi>${esc(friend.name)}</bdi>`;
  app.innerHTML = `
    <section class="screen duel-new has-tabbar">
      ${topbar()}
      <h1 class="greeting">${esc(t('duel.newTitle'))}</h1>
      <p class="sub">${friend ? t('duel.newFor', { name: friendName }) : esc(t('duel.newSub'))}</p>
      ${stepsCard(t('duel.stepsTitle'), [esc(t('duel.step1')), friend ? t('duel.step2For', { name: friendName }) : esc(t('duel.step2')), esc(t('duel.step3'))])}
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
  state.duels = null; // this screen can answer what the home screen was asking for
  app.innerHTML = `<section class="screen duel has-tabbar">${topbar()}<p class="sub">${esc(t('duel.loading'))}</p></section>${tabbar('friends')}`;
  let duel;
  try {
    await pendingSave;
    ({ duel } = await api(`/api/duels/${encodeURIComponent(id)}`));
    learn(duel.questions);
    if (nav !== navId) return;
  } catch (err) {
    if (nav !== navId) return;
    if (err.status === 401) return signOut();
    app.querySelector('.sub').textContent = errMsg(err);
    return;
  }

  const max = duel.count * MAX_POINTS;
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
        <p class="challenge-sub">${esc(t('duel.howToPlay'))}${duel.isFriend ? '' : ` ${t('duel.willFriend', { name: personName(c) })}`}</p>
        ${isNew() ? howItWorks() : ''}
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
        <p class="challenge-sub">${esc(t('duel.howToPlay'))}</p>
        <button class="btn btn-marigold btn-block" data-play>${esc(t('duel.play'))}</button>
      </div>`;
  } else if (duel.status === 'waiting') {
    const mine = duel[duel.role];
    body = `
      <div class="panel challenge-card">
        ${avatar(state.profile?.avatar, 80)}
        <p class="result-score">${mine.score}<small>/${max}</small></p>
        <p class="result-line">${esc(t('daily.rightOf', { right: mine.correct ?? 0, total: duel.count }))}</p>
        ${xpEarned('duel', mine.score)}
        <p class="challenge-sub">${duel.invitedFriend?.name
          ? t('duel.waitingInvited', { name: personName(other) })
          : other?.name ? t('duel.waitingFor', { name: personName(other) }) : esc(t('duel.sendLink'))}</p>
        ${duel.opponent ? '' : `
          <div class="share-row">
            <button class="btn btn-marigold" data-share>${ICONS.share}<span>${esc(t('duel.sendButton'))}</span></button>
            <button class="btn btn-ghost-ink" data-copy>${ICONS.copy}<span>${esc(t('share.copyLink'))}</span></button>
          </div>
          <p class="share-status" data-share-status aria-live="polite"></p>`}
      </div>`;
  } else {
    body = duelResultHtml(duel, max);
  }

  app.innerHTML = `
    <section class="screen duel has-tabbar">
      ${topbar()}
      <p class="eyebrow on-cobalt">${esc(t('duel.title'))} · ${esc(duelTopic(duel.category))}</p>
      ${body}
    </section>
    ${tabbar('friends')}`;

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
  const shareMsg = !mine ? '' : duel.status === 'done'
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
  const secs = (ms) => t('unit.seconds', { s: (ms / 1000).toFixed(1) });
  const decidedByTime = them && duel.winner && duel.winner !== 'draw' && me.score === them.score;
  return `
    <div class="panel versus ${duel.winner === meSide ? 'is-win' : ''}">
      <p class="verdict">${verdict}</p>
      <div class="versus-row">
        <div class="versus-side ${duel.winner === (meSide || 'challenger') ? 'is-winner' : ''}">
          ${coveredAvatar(me, 84)}
          <span class="versus-name">${meSide ? esc(t('duel.you')) : personName(me)}</span>
          <span class="versus-score">${me.score}</span>
        </div>
        <span class="versus-vs">${esc(t('duel.vs'))}</span>
        <div class="versus-side ${duel.winner === (meSide ? themSide : 'opponent') ? 'is-winner' : ''}">
          ${coveredAvatar(them, 84)}
          <span class="versus-name">${personName(them)}</span>
          <span class="versus-score">${them?.score ?? '–'}</span>
        </div>
      </div>
      <p class="result-line">${esc(t('duel.outOf', { max }))}</p>
      ${meSide ? xpEarned('duel', me.score) : ''}
      ${decidedByTime ? `<p class="result-line">${t('duel.tieTime', { me: meSide ? esc(t('duel.you')) : personName(me), myTime: esc(secs(me.ms)), them: personName(them), theirTime: esc(secs(them.ms)) })}</p>` : ''}
      ${meSide ? `
        <div class="share-row">
          <button class="btn btn-marigold" data-rematch>${ICONS.duel}<span>${esc(t('duel.rematch'))}</span></button>
          <button class="btn btn-ghost-ink" data-share>${ICONS.share}<span>${esc(t('share.share'))}</span></button>
        </div>
        <p class="share-status" data-share-status aria-live="polite"></p>` : ''}
    </div>
    ${!meSide ? `<a class="btn btn-marigold btn-block" href="#/duel/new">${esc(t('duel.startOwn'))}</a>` : `
      <h2 class="section-title">${esc(t('duel.byQuestion'))}</h2>
      <ol class="compare">
        <li class="compare-head"><span></span><span>${esc(t('duel.you'))}</span><span>${them?.name ? `<bdi>${esc(them.name)}</bdi>` : '–'}</span></li>
        ${duel.questionIds.map((id) => QUESTION_BY_ID.get(id)).filter(Boolean).map((q) => `
          <li>
            <span class="compare-q"><strong>${esc(qt(q, q.answer))}</strong>${diffChip(q)}</span>
            ${pill(mine.get(q.id))}
            ${pill(theirs.get(q.id))}
          </li>`).join('')}
      </ol>`}`;
}

// ── Leveling ───────────────────────────────────────────────────
// Stages an admin writes on the dashboard, played in order on the server. "Level" is the player's
// own level; a step on this path is a stage.

async function loadStages() {
  state.stages = (await api('/api/stages')).stages;
  return state.stages;
}

const xpLabel = (xp) => `<bdi dir="ltr">+${xp} XP</bdi>`;

/** Leveling on the home screen. It isn't there until an admin publishes a stage. */
function levelingRow() {
  const stages = state.stages;
  if (!stages?.length) return '';
  const next = stages.find((s) => s.status === 'open');
  return homeRow({
    href: '#/leveling',
    icon: ICONS.leveling,
    title: esc(t('leveling.title')),
    sub: next ? t('leveling.rowNext', { n: stages.indexOf(next) + 1, total: stages.length, xp: xpLabel(XP.stageClear) }) : esc(t('leveling.rowDone')),
  });
}

/** Starts a try at a stage, or picks up the one still open. */
async function playStage(id) {
  const { play, stage } = await api(`/api/stages/${id}/start`, { method: 'POST' });
  track('round_started', { mode: DEFAULT_MODE, category: 'stage' });
  playFixed({ kind: 'stage', title: stage.title, after: `#/leveling/${id}`, play, endpoint: `/api/stages/${id}/finish`, extra: {} });
}

/** Wires up the buttons that start a stage. */
function bindStageButtons() {
  app.querySelectorAll('[data-play-stage]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await playStage(Number(b.dataset.playStage));
    } catch (err) {
      if (err.status === 401) return signOut();
      if (err.status === 403 || err.status === 404) return route(); // an admin changed the path meanwhile
      b.disabled = false;
      window.alert(errMsg(err));
    }
  }));
}

function stageNode(s, i) {
  const locked = s.status === 'locked';
  const cleared = s.status === 'cleared';
  const mark = cleared ? ICONS.check : locked ? ICONS.lock : `<span dir="ltr">${i + 1}</span>`;
  const line = locked
    ? t('leveling.locked')
    : [tn('leveling.questions', s.count), s.best ? t('leveling.best', { c: s.best.correct, t: s.best.total }) : ''].filter(Boolean).join(' · ');
  return `
    <li class="stage-node is-${s.status}">
      <button type="button" class="stage-card" ${locked ? 'disabled' : `data-play-stage="${s.id}"`}>
        <span class="stage-mark">${mark}</span>
        <span class="stage-text">
          <small>${esc(t('leveling.stage', { n: i + 1 }))}</small>
          <strong dir="auto">${esc(s.title)}</strong>
          <span>${esc(line)}</span>
        </span>
        ${s.status === 'open' ? `<span class="stage-xp" dir="ltr">+${XP.stageClear} XP</span>` : cleared ? `<span class="stage-again">${esc(t('leveling.replay'))}</span>` : ''}
      </button>
    </li>`;
}

/** Loads the stages for a Leveling screen. Null when the screen has already dealt with it. */
async function stagesForScreen(nav) {
  try {
    await pendingSave;
    const stages = await loadStages();
    return nav === navId ? stages : null;
  } catch (err) {
    if (nav !== navId) return null;
    if (err.status === 401) signOut();
    else app.querySelector('.sub').textContent = t('leveling.loadFailed', { error: errMsg(err) });
    return null;
  }
}

const levelingLoading = () => `
  <section class="screen leveling has-tabbar">${topbar()}<h1 class="greeting">${esc(t('leveling.title'))}</h1><p class="sub">${esc(t('leveling.loading'))}</p></section>
  ${tabbar('home')}`;

async function showLeveling() {
  const nav = navId;
  app.innerHTML = levelingLoading();
  const stages = await stagesForScreen(nav);
  if (!stages) return;
  if (!stages.length) return go('#/', { replace: true });
  const cleared = stages.filter((s) => s.status === 'cleared').length;
  app.innerHTML = `
    <section class="screen leveling has-tabbar">
      ${topbar()}
      <h1 class="greeting">${esc(t('leveling.title'))}</h1>
      <p class="sub">${t('leveling.intro', { percent: STAGE.clearPercent, xp: xpLabel(XP.stageClear) })}</p>
      <p class="stage-progress">${esc(t('leveling.progress', { c: cleared, t: stages.length }))}</p>
      <ol class="stage-path">${stages.map(stageNode).join('')}</ol>
    </section>
    ${tabbar('home')}`;
  bindStageButtons();
}

/** How the last try at a stage went. */
async function showStageResult(id) {
  const nav = navId;
  app.innerHTML = levelingLoading();
  const stages = await stagesForScreen(nav);
  if (!stages) return;
  const at = stages.findIndex((s) => s.id === id);
  const stage = stages[at];
  if (!stage?.last) return go('#/leveling', { replace: true }); // not played, or an admin removed it
  const r = stage.last;
  const need = Math.ceil((r.total * STAGE.clearPercent) / 100);
  const next = stages[at + 1];
  const nextOpen = r.cleared && next && next.status !== 'locked';
  const primary = nextOpen
    ? `<button class="btn btn-marigold btn-block" data-play-stage="${next.id}">${esc(t('leveling.next'))}</button>`
    : r.cleared
      ? `<button class="btn btn-marigold btn-block" data-play-stage="${id}">${esc(t('leveling.replay'))}</button>`
      : `<button class="btn btn-marigold btn-block" data-play-stage="${id}">${esc(t('leveling.again'))}</button>`;
  app.innerHTML = `
    <section class="screen leveling has-tabbar">
      ${topbar()}
      <div class="panel stage-result ${r.cleared ? 'is-cleared' : ''}">
        <p class="eyebrow" dir="auto">${esc(stage.title)}</p>
        <h1 class="stage-verdict">${esc(t(r.cleared ? 'leveling.resCleared' : 'leveling.resFailed'))}</h1>
        <p class="result-score" dir="ltr">${r.correct}<small>/${r.total}</small></p>
        <p class="result-line">${esc(t('leveling.resRight', { score: r.score }))}</p>
        ${r.cleared ? '' : `<p class="challenge-sub">${esc(t('leveling.resNeed', { need, t: r.total }))}</p>`}
        <dl class="stage-xp-sum">
          <div><dt>${esc(t('leveling.xpRound'))}</dt><dd dir="ltr">+${r.xp} XP</dd></div>
          ${r.bonus ? `<div class="is-bonus"><dt>${esc(t('leveling.xpBonus'))}</dt><dd dir="ltr">+${r.bonus} XP</dd></div>` : ''}
        </dl>
        ${r.cleared && !r.bonus ? `<p class="challenge-sub">${esc(t('leveling.noBonus'))}</p>` : ''}
        ${primary}
        <a class="btn btn-ghost-ink btn-block" href="#/leveling">${esc(t('leveling.all'))}</a>
      </div>
    </section>
    ${tabbar('home')}`;
  bindStageButtons();
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
      ${coveredAvatar(other, 44)}
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

      ${turn.length ? `<div class="panel"><h2 class="panel-title">${esc(t('friends.yourTurn'))}</h2><ul class="people">${turn.map(duelRow).join('')}</ul></div>` : ''}

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

      ${waiting.length ? `<div class="panel"><h2 class="panel-title">${esc(t('friends.waiting'))}</h2><ul class="people">${waiting.map(duelRow).join('')}</ul></div>` : ''}

      <div class="panel">
        <h2 class="panel-title">${esc(tn('friends.count', data.friends.length))}</h2>
        ${data.friends.length ? `<ul class="people">${data.friends.map((f) => `
          <li class="person-row">
            ${coveredAvatar(f, 44)}
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
      const { friend } = await api('/api/friends', { method: 'POST', body: { code } });
      // A new player goes home, where the new friend waits as a duel next to the first round.
      if (isNew()) state.newFriend = friend;
      go(isNew() ? '#/' : '#/friends', { replace: true });
    } catch (err) {
      e.currentTarget.disabled = false;
      app.querySelector('[data-add-msg]').textContent = errMsg(err);
    }
  });
}

// ── Profile ────────────────────────────────────────────────────

// The profile screen shows one thing at a time: a part of the avatar, or the name and country.
const PROFILE_TABS = [
  { id: 'animal', label: 'profile.animal', values: ANIMALS },
  { id: 'eyes', label: 'profile.face', values: EYES },
  { id: 'bg', label: 'profile.color', values: Object.keys(BACKGROUNDS) },
  { id: 'extra', label: 'profile.extra', values: EXTRAS },
  { id: 'details', label: 'profile.details' },
];
// Stays put between visits. "Try it on" in the level-up sheet opens the tab of what was unlocked.
let profileTab = 'animal';

function showProfile() {
  const p = state.profile;
  const level = p.level;
  const saved = parseAvatar(p.avatar) || parseAvatar(randomAvatar(state.user.id));
  let draft = { ...saved };
  const code = () => avatarCode(draft);
  const itemName = (part, value) => t(`avatar.${part}.${value}`);

  /** What stops this avatar being saved: its most demanding locked part. An avatar already worn always can be. */
  function blocker() {
    if (code() === p.avatar) return null;
    const locked = Object.keys(draft).filter((part) => unlockLevel(part, draft[part]) > level)
      .sort((a, b) => unlockLevel(b, draft[b]) - unlockLevel(a, draft[a]));
    return locked.length ? { part: locked[0], value: draft[locked[0]], need: unlockLevel(locked[0], draft[locked[0]]) } : null;
  }

  function tile(part, value) {
    const need = unlockLevel(part, value);
    const locked = need > level;
    const label = esc(locked ? `${itemName(part, value)} · ${t('profile.unlocksAt', { n: need })}` : itemName(part, value));
    const picture = part === 'bg'
      ? `<span class="swatch" style="background:${backgroundCss(value)}"></span>`
      : avatarImg(avatarCode({ ...draft, [part]: value }), 64);
    return `<button type="button" class="avatar-choice ${locked ? 'is-locked' : ''}" data-part="${part}" data-value="${value}" aria-pressed="${draft[part] === value}" aria-label="${label}" title="${label}">${picture}${locked ? `<span class="lock-chip" dir="ltr" aria-hidden="true">${ICONS.lock}${need}</span>` : ''}</button>`;
  }

  /** The line above a list: skins are free; add-ons say how many are open and what's next. */
  function tabProgress(tab) {
    if (tab.id === 'animal') return `<span>${esc(t('profile.skinsFree'))}</span>`;
    const open = tab.values.filter((v) => unlockLevel(tab.id, v) <= level).length;
    const next = UNLOCKS.find((u) => u.part === tab.id && u.level > level);
    return `<strong>${esc(t('profile.unlockedCount', { n: open, total: tab.values.length }))}</strong><span>${esc(next ? t('profile.nextHere', { item: itemName(next.part, next.value), n: next.level }) : t('profile.allHere'))}</span>`;
  }

  function panelHtml() {
    const tab = PROFILE_TABS.find((x) => x.id === profileTab);
    return `
      <p class="studio-progress">${tabProgress(tab)}</p>
      <div class="${tab.id === 'bg' ? 'swatch-grid' : 'avatar-grid'}">${tab.values.map((v) => tile(tab.id, v)).join('')}</div>`;
  }

  const countries = [...COUNTRIES].sort((a, b) => countryName(a).localeCompare(countryName(b), locale()));

  app.innerHTML = `
    <section class="screen profile has-tabbar">
      ${topbar()}
      <form class="studio" data-form novalidate>
        <div class="studio-top">
          <div class="studio-head">
            <span class="studio-avatar" data-preview></span>
            <div class="studio-side">
              <h1 class="studio-title">${esc(t('profile.title'))}</h1>
              ${levelBar()}
              <div class="studio-status" data-status></div>
            </div>
          </div>
          <div class="seg studio-tabs" role="tablist" aria-label="${esc(t('profile.tabsAria'))}">
            ${PROFILE_TABS.map((tab) => `<button type="button" role="tab" data-tab="${tab.id}" aria-controls="${tab.id === 'details' ? 'studio-details' : 'studio-panel'}" aria-selected="${tab.id === profileTab}">${esc(t(tab.label))}</button>`).join('')}
          </div>
        </div>
        <div class="panel studio-panel" id="studio-panel" role="tabpanel" data-panel></div>
        <p class="level-how" data-how>${esc(t('level.how', { finished: XP.finished, daily: XP.bonus.daily, duel: XP.bonus.duel, stage: XP.stageClear }))}</p>
        <div class="panel profile-details" id="studio-details" role="tabpanel" data-details hidden>
          <label class="field">
            <span>${esc(t('profile.name'))}</span>
            <input name="name" maxlength="20" value="${esc(p.name)}" autocomplete="nickname" required>
          </label>
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
        </div>
        <div class="studio-save">
          <p class="form-msg" data-msg role="status"></p>
          <button class="btn btn-marigold btn-block" type="submit" data-save>${esc(t('profile.save'))}</button>
        </div>
      </form>
    </section>
    ${tabbar('progress')}`;

  const form = app.querySelector('[data-form]');
  const preview = app.querySelector('[data-preview]');
  const status = app.querySelector('[data-status]');
  const panel = app.querySelector('[data-panel]');
  const how = app.querySelector('[data-how]');
  const details = app.querySelector('[data-details]');
  const msg = app.querySelector('[data-msg]');
  const save = app.querySelector('[data-save]');

  let statusKey = null;
  /** The note beside the avatar and the save button: both say so when a locked part is on. */
  function drawStatus() {
    const b = blocker();
    save.disabled = !!b;
    save.textContent = b ? t('profile.saveLocked', { n: b.need }) : t('profile.save');
    const key = b ? `${b.part}:${b.value}` : '';
    if (key === statusKey) return; // keeps the button under the player's finger and focus
    statusKey = key;
    status.innerHTML = b
      ? `<p class="studio-lock" role="status">${ICONS.lock}<span>${esc(t('profile.lockedItem', { item: itemName(b.part, b.value), n: b.need }))}</span></p>
         <button type="button" class="btn btn-small btn-ghost" data-take-off>${esc(t('profile.takeOff'))}</button>`
      : `<button type="button" class="btn btn-small btn-ghost" data-random>${ICONS.dice}<span>${esc(t('profile.random'))}</span></button>`;
  }

  function draw() {
    preview.innerHTML = coveredAvatar({ avatar: code(), level }, 72);
    msg.textContent = '';
    drawStatus();
    if (profileTab !== 'details') panel.innerHTML = panelHtml();
  }

  function openTab(id) {
    profileTab = id;
    const isDetails = id === 'details';
    form.classList.toggle('is-details', isDetails);
    app.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    panel.hidden = isDetails;
    how.hidden = isDetails;
    details.hidden = !isDetails;
    if (!isDetails) panel.innerHTML = panelHtml();
    // The new list starts right under the avatar, however far down the last one was.
    const formTop = form.getBoundingClientRect().top + window.scrollY;
    if (window.scrollY > formTop) window.scrollTo(0, formTop);
  }

  app.querySelector('.studio-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) openTab(tab.dataset.tab);
  });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-part]');
    if (!b) return;
    draft = { ...draft, [b.dataset.part]: b.dataset.value };
    draw();
    panel.querySelector(`[data-value="${b.dataset.value}"]`)?.focus({ preventScroll: true });
  });
  status.addEventListener('click', (e) => {
    if (e.target.closest('[data-random]')) {
      draft = parseAvatar(randomAvatar(undefined, level));
      draw();
    } else if (e.target.closest('[data-take-off]')) {
      for (const part of Object.keys(draft)) {
        if (unlockLevel(part, draft[part]) <= level) continue;
        // Back to what's saved, or the first free choice if that's locked too (a part worn since before its unlock moved).
        draft[part] = unlockLevel(part, saved[part]) <= level ? saved[part] : PROFILE_TABS.find((x) => x.id === part).values[0];
      }
      draw();
      status.querySelector('[data-random]')?.focus({ preventScroll: true });
    }
  });
  form.elements.country.addEventListener('change', () => {
    app.querySelector('[data-flag]').innerHTML = flagImg(form.elements.country.value || null);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (blocker()) return;
    const name = form.elements.name.value.trim();
    if (!name) {
      openTab('details');
      msg.textContent = t('profile.needName');
      form.elements.name.focus();
      return;
    }
    save.disabled = true;
    try {
      const { profile } = await api('/api/profile', {
        method: 'PUT',
        body: { name, avatar: code(), country: form.elements.country.value || null, hidden: !form.elements.shown.checked },
      });
      state.profile = profile;
      go('#/progress');
    } catch (err) {
      save.disabled = false;
      msg.textContent = errMsg(err);
    }
  });

  openTab(profileTab);
  preview.innerHTML = coveredAvatar({ avatar: code(), level }, 72);
  drawStatus();
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
  app.innerHTML = `<section class="screen progress has-tabbar"><header class="topbar">${topbarStart()}</header><p class="sub">${esc(t('prog.loading'))}</p></section>${tabbar('progress')}`;
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

  const toReview = s.missed.filter((m) => QUESTION_BY_ID.get(m.id)?.visual).slice(0, 6);
  const topicName = (id) => esc(catName(CATEGORY_BY_ID[id]));

  app.innerHTML = `
    <section class="screen progress has-tabbar">
      <header class="topbar">
        ${topbarStart()}
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
          <div><dt>${esc(t('prog.mastered'))}</dt><dd>${s.masteredIds.length}<small>/${QUESTIONS.length}</small></dd><p>${esc(t('prog.masteredHint'))}</p></div>
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
        <div class="setting setting-choice">
          <span id="back-title"><strong>${esc(t('set.back'))}</strong><span>${esc(t('set.backHint'))}</span></span>
          <div class="choice" role="radiogroup" aria-labelledby="back-title">
            ${BACK_BUTTON.map((m) => `<label><input type="radio" name="back-button" value="${m}" ${(getSetting('backButton') || 'phones') === m ? 'checked' : ''}><span>${esc(t(`set.back.${m}`))}</span></label>`).join('')}
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
          ${user.admin ? `<a class="link-btn" href="#/admin/players">${esc(t('acc.players'))}</a><a class="link-btn" href="#/admin">${esc(t('acc.reports'))}</a><a class="link-btn" href="#/admin/stages">${esc(t('acc.stages'))}</a>` : ''}
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
  app.querySelectorAll('input[name="back-button"]').forEach((input) => input.addEventListener('change', () => {
    setSetting('backButton', input.value);
    app.querySelector('.topbar-start').outerHTML = topbarStart(); // the arrow up top appears or goes at once
  }));
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
      <header class="topbar">${topbarStart()}</header>
      <nav class="admin-sections" aria-label="${esc(t('admin.nav.aria'))}">${link('players', '#/admin/players')}${link('reports', '#/admin')}${link('stages', '#/admin/stages')}</nav>
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

    <div class="panel">
      <h2 class="panel-title">${esc(t('players.firstRound'))}</h2>
      <ul class="returns">
        ${[['players.startedRound', r.firstRound.started], ['players.finishedRound', r.firstRound.finished]].map(([key, n]) => {
          const p = pct(n, r.firstRound.players);
          return `
            <li>
              <span class="returns-head"><strong>${esc(t(key))}</strong><span>${esc(r.firstRound.players ? t('players.dOf', { x: n, y: r.firstRound.players }) : t('players.noData'))}</span></span>
              <span class="returns-num">${p === null ? '–' : `${p}%`}</span>
              <span class="meter meter-ink returns-meter"><span style="width:${p ?? 0}%"></span></span>
            </li>`;
        }).join('')}
      </ul>
      <p class="legend">${esc(r.firstRound.medianMin === null ? t('players.firstRoundHint') : t('players.medianWait', { n: r.firstRound.medianMin }))}</p>
    </div>

    <p class="sub admin-note">${esc(t('players.note'))}</p>`);
}

// ── Admin: Leveling stages ─────────────────────────────────────

/** The server's own words for a form to show, since they say exactly what to fix. */
const adminError = (err) => ([400, 404, 409].includes(err.status) ? err.message : errMsg(err));

/** A small round button that moves a row up or down the list. */
const moveButton = (direction, disabled, attrs) =>
  `<button type="button" class="icon-btn icon-btn-ink stage-move is-${direction}" ${attrs} data-move="${direction}" ${disabled ? 'disabled' : ''} aria-label="${esc(t(`stages.${direction}`))}" title="${esc(t(`stages.${direction}`))}">${ICONS.chevron}</button>`;

async function showAdminStages() {
  const nav = navId;
  const frame = (body) => adminFrame('stages', `<h1 class="section-title">${esc(t('stages.title'))}</h1>${body}`);
  app.innerHTML = frame(`<p class="sub">${esc(t('stages.loading'))}</p>`);
  let stages;
  try {
    ({ stages } = await api('/api/admin/stages'));
    if (nav !== navId) return;
  } catch (err) {
    if (nav !== navId) return;
    if (err.status === 401) return signOut();
    app.querySelector('.sub').textContent = t('stages.loadFailed', { error: errMsg(err) });
    return;
  }

  const row = (s, i) => `
    <li class="stage-admin-row">
      <span class="stage-admin-n" dir="ltr">${i + 1}</span>
      <a class="stage-admin-link" href="#/admin/stages/${s.id}">
        <strong dir="auto">${esc(s.title)}</strong>
        <span><span class="stage-chip ${s.published ? 'is-live' : ''}">${esc(t(s.published ? 'stages.live' : 'stages.draft'))}</span> ${esc(tn('leveling.questions', s.count))}</span>
      </a>
      ${moveButton('up', i === 0, `data-id="${s.id}"`)}
      ${moveButton('down', i === stages.length - 1, `data-id="${s.id}"`)}
    </li>`;
  const first = !stages.length;

  const draw = () => {
    app.querySelector('[data-stage-list]').innerHTML = stages.map(row).join('');
  };

  app.innerHTML = frame(`
    ${first ? `
      <div class="panel stage-empty">
        <span class="daily-badge">${ICONS.leveling}</span>
        <h2>${esc(t('stages.emptyTitle'))}</h2>
        <p>${esc(t('stages.emptyHint'))}</p>
      </div>` : `
      <div class="panel"><ol class="stage-admin-list" data-stage-list></ol></div>`}
    <form class="panel stage-form" data-new-stage novalidate>
      <label class="field">
        <span>${esc(t(first ? 'stages.firstName' : 'stages.newName'))}</span>
        <input name="title" maxlength="${STAGE.titleMax}" dir="auto" autocomplete="off">
      </label>
      <p class="form-msg is-error" data-msg role="status"></p>
      <button class="btn btn-marigold btn-block" type="submit">${esc(t(first ? 'stages.createFirst' : 'stages.create'))}</button>
    </form>`);
  if (!first) draw();

  app.querySelector('[data-stage-list]')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-move]');
    if (!b) return;
    b.disabled = true;
    try {
      ({ stages } = await api(`/api/admin/stages/${b.dataset.id}/move`, { method: 'POST', body: { direction: b.dataset.move } }));
      draw();
    } catch (err) {
      window.alert(adminError(err));
      showAdminStages();
    }
  });
  app.querySelector('[data-new-stage]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    const msg = e.target.querySelector('[data-msg]');
    btn.disabled = true;
    msg.textContent = '';
    try {
      const { stage } = await api('/api/admin/stages', { method: 'POST', body: { title: e.target.elements.title.value } });
      go(`#/admin/stages/${stage.id}`);
    } catch (err) {
      btn.disabled = false;
      msg.textContent = adminError(err);
    }
  });
}

async function showAdminStage(id) {
  const nav = navId;
  const frame = (body) => adminFrame('stages', body);
  app.innerHTML = frame(`<p class="sub">${esc(t('stages.loading'))}</p>`);
  let stage;
  let questions;
  try {
    ({ stage, questions } = await api(`/api/admin/stages/${id}`));
    if (nav !== navId) return;
  } catch (err) {
    if (nav !== navId) return;
    if (err.status === 401) return signOut();
    if (err.status === 404) return go('#/admin/stages', { replace: true });
    app.querySelector('.sub').textContent = t('stages.loadFailed', { error: errMsg(err) });
    return;
  }
  let editing = null; // the question being changed in the form, or null when adding one

  const headHtml = () => `
    <form class="panel stage-form" data-rename novalidate>
      <label class="field">
        <span>${esc(t('stages.name'))}</span>
        <input name="title" maxlength="${STAGE.titleMax}" dir="auto" autocomplete="off" value="${esc(stage.title)}">
      </label>
      <p class="form-msg is-error" data-msg role="status"></p>
      <div class="stage-form-actions">
        <button class="btn btn-ghost-ink" type="submit">${esc(t('stages.saveName'))}</button>
        <button class="btn ${stage.published ? 'btn-ghost-ink' : 'btn-marigold'}" type="button" data-publish ${!stage.published && stage.count < STAGE.minQuestions ? 'disabled' : ''}>${esc(t(stage.published ? 'stages.unpublish' : 'stages.publish'))}</button>
      </div>
      <p class="stage-hint"><span class="stage-chip ${stage.published ? 'is-live' : ''}">${esc(t(stage.published ? 'stages.live' : 'stages.draft'))}</span> ${esc(
        stage.published ? t('stages.publishedNote') : stage.count < STAGE.minQuestions ? t('stages.needMore', { n: STAGE.minQuestions, have: stage.count }) : t('stages.draftNote'),
      )}</p>
    </form>`;

  const questionRow = (q, i) => `
    <li class="stage-q-row" data-qid="${q.id}">
      <div class="stage-q-top">
        <span class="stage-admin-n" dir="ltr">${i + 1}</span>
        <div class="stage-q-text">
          <h3 class="admin-q" dir="auto">${esc(q.prompt)}</h3>
          <p class="admin-answers"><strong dir="auto">${esc(q.answer)}</strong> · ${q.wrong.map((w) => `<span dir="auto">${esc(w)}</span>`).join(' · ')}</p>
        </div>
        ${q.picture ? `<img class="stage-thumb" src="${esc(q.picture)}" alt="" loading="lazy">` : ''}
      </div>
      <div class="stage-q-actions">
        ${moveButton('up', i === 0, '')}
        ${moveButton('down', i === questions.length - 1, '')}
        <button type="button" class="btn btn-small btn-ghost-ink" data-edit>${esc(t('stages.edit'))}</button>
        <button type="button" class="btn btn-small btn-ghost-ink" data-delete>${esc(t('stages.deleteQuestion'))}</button>
      </div>
    </li>`;

  const listHtml = () => (questions.length
    ? `<ol class="stage-q-list">${questions.map(questionRow).join('')}</ol>`
    : `<p class="board-empty">${esc(t('stages.noQuestions'))}</p>`);

  const optionField = (name, label) => `
    <label class="field">
      <span>${esc(label)}</span>
      <input name="${name}" maxlength="${STAGE.optionMax}" dir="auto" autocomplete="off">
    </label>`;

  app.innerHTML = frame(`
    <a class="stage-back" href="#/admin/stages">${ICONS.back}<span>${esc(t('stages.back'))}</span></a>
    <div data-head>${headHtml()}</div>
    <div class="panel">
      <h2 class="panel-title">${esc(t('stages.questionsTitle'))} <span class="stage-count" dir="ltr">${stage.count}/${STAGE.maxQuestions}</span></h2>
      <div data-questions>${listHtml()}</div>
    </div>
    <form class="panel stage-form" data-question novalidate>
      <h2 class="panel-title" data-form-title>${esc(t('stages.addQuestion'))}</h2>
      <label class="field">
        <span>${esc(t('stages.prompt'))}</span>
        <textarea name="prompt" rows="3" maxlength="${STAGE.promptMax}" dir="auto"></textarea>
      </label>
      ${optionField('answer', t('stages.answer'))}
      ${Array.from({ length: STAGE.wrongOptions }, (_, i) => optionField(`wrong${i}`, t('stages.wrong', { n: i + 1 }))).join('')}
      <label class="field">
        <span>${esc(t('stages.picture'))}</span>
        <input name="picture" maxlength="${STAGE.pictureMax}" dir="ltr" inputmode="url" autocomplete="off" spellcheck="false">
      </label>
      <p class="stage-hint">${esc(t('stages.pictureHint', { hosts: STAGE_PICTURE_HOSTS.join(', ') }))}</p>
      <img class="stage-pic" data-pic alt="" hidden>
      <p class="form-msg is-error" data-pic-msg role="status"></p>
      <p class="form-msg is-error" data-msg role="status"></p>
      <div class="stage-form-actions">
        <button class="btn btn-ghost-ink" type="button" data-cancel hidden>${esc(t('common.cancel'))}</button>
        <button class="btn btn-marigold" type="submit" data-submit>${esc(t('stages.saveQuestion'))}</button>
      </div>
    </form>
    <button type="button" class="btn btn-ghost btn-block stage-delete" data-delete-stage>${esc(t('stages.delete'))}</button>`);

  const form = app.querySelector('[data-question]');
  const pic = form.querySelector('[data-pic]');
  const picMsg = form.querySelector('[data-pic-msg]');
  const formMsg = form.querySelector('[data-msg]');

  const showPicture = () => {
    const src = form.elements.picture.value.trim();
    picMsg.textContent = '';
    pic.hidden = true;
    if (src) pic.src = src;
    else pic.removeAttribute('src');
  };
  pic.addEventListener('load', () => { pic.hidden = false; picMsg.textContent = ''; });
  pic.addEventListener('error', () => {
    pic.hidden = true;
    if (form.elements.picture.value.trim()) picMsg.textContent = t('stages.pictureFailed');
  });
  form.elements.picture.addEventListener('change', showPicture);

  /** Draws what depends on the stage and its questions, after anything changes on the server. */
  const redraw = (data) => {
    if (data) ({ stage, questions } = data);
    app.querySelector('[data-head]').innerHTML = headHtml();
    app.querySelector('[data-questions]').innerHTML = listHtml();
    app.querySelector('.stage-count').textContent = `${stage.count}/${STAGE.maxQuestions}`;
    bindHead();
  };

  const resetForm = () => {
    editing = null;
    form.reset();
    formMsg.textContent = '';
    showPicture();
    form.querySelector('[data-form-title]').textContent = t('stages.addQuestion');
    form.querySelector('[data-submit]').textContent = t('stages.saveQuestion');
    form.querySelector('[data-cancel]').hidden = true;
  };

  function bindHead() {
    const head = app.querySelector('[data-rename]');
    const msg = head.querySelector('[data-msg]');
    head.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '';
      try {
        ({ stage } = await api(`/api/admin/stages/${id}`, { method: 'PUT', body: { title: head.elements.title.value } }));
        redraw();
      } catch (err) {
        msg.textContent = adminError(err);
      }
    });
    head.querySelector('[data-publish]').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      msg.textContent = '';
      try {
        ({ stage } = await api(`/api/admin/stages/${id}`, { method: 'PUT', body: { published: !stage.published } }));
        redraw();
      } catch (err) {
        e.target.disabled = false;
        msg.textContent = adminError(err);
      }
    });
  }
  bindHead();

  app.querySelector('[data-questions]').addEventListener('click', async (e) => {
    const row = e.target.closest('[data-qid]');
    if (!row) return;
    const qid = Number(row.dataset.qid);
    const url = `/api/admin/stages/${id}/questions/${qid}`;
    try {
      if (e.target.closest('[data-move]')) {
        redraw(await api(`${url}/move`, { method: 'POST', body: { direction: e.target.closest('[data-move]').dataset.move } }));
      } else if (e.target.closest('[data-edit]')) {
        const q = questions.find((x) => x.id === qid);
        editing = q.id;
        form.elements.prompt.value = q.prompt;
        form.elements.answer.value = q.answer;
        q.wrong.forEach((w, i) => { form.elements[`wrong${i}`].value = w; });
        form.elements.picture.value = q.picture ?? '';
        showPicture();
        formMsg.textContent = '';
        form.querySelector('[data-form-title]').textContent = t('stages.editQuestion');
        form.querySelector('[data-submit]').textContent = t('stages.saveChanges');
        form.querySelector('[data-cancel]').hidden = false;
        form.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
      } else if (e.target.closest('[data-delete]')) {
        if (!window.confirm(t('stages.deleteQuestionConfirm'))) return;
        redraw(await api(url, { method: 'DELETE' }));
        if (editing === qid) resetForm();
      }
    } catch (err) {
      window.alert(adminError(err));
    }
  });

  form.querySelector('[data-cancel]').addEventListener('click', resetForm);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('[data-submit]');
    submit.disabled = true;
    formMsg.textContent = '';
    const el = form.elements;
    const body = {
      prompt: el.prompt.value, answer: el.answer.value, picture: el.picture.value,
      wrong: Array.from({ length: STAGE.wrongOptions }, (_, i) => el[`wrong${i}`].value),
    };
    try {
      const url = `/api/admin/stages/${id}/questions`;
      redraw(await api(editing ? `${url}/${editing}` : url, { method: editing ? 'PUT' : 'POST', body }));
      resetForm();
      el.prompt.focus({ preventScroll: true });
    } catch (err) {
      formMsg.textContent = adminError(err);
    } finally {
      submit.disabled = false;
    }
  });

  app.querySelector('[data-delete-stage]').addEventListener('click', async () => {
    if (!window.confirm(t('stages.deleteConfirm', { title: stage.title }))) return;
    try {
      await api(`/api/admin/stages/${id}`, { method: 'DELETE' });
      go('#/admin/stages', { replace: true });
    } catch (err) {
      window.alert(adminError(err));
    }
  });
}

// ── Admin: question reports ────────────────────────────────────

const REASON_BY_ID = Object.fromEntries(REPORT_REASONS.map((r) => [r.id, r]));
const STATUS_TABS = ['open', 'fixed', 'dismissed'];

async function showAdmin(status = 'open', sub = null) {
  if (status === 'players') return showPlayers();
  if (status === 'stages') return sub ? showAdminStage(Number(sub)) : showAdminStages();
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
    let questions;
    ({ reports, questions } = await api(`/api/admin/reports?status=${status}`));
    learn(questions);
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
            <p class="admin-answers"><strong>${esc(q.answer)}</strong> · ${q.options.filter((o) => o !== q.answer).map(esc).join(' · ')}</p>
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
