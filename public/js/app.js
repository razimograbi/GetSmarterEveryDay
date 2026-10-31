import { QUESTIONS, QUESTION_BY_ID } from '/shared/questions.js';
import {
  MODES, DEFAULT_MODE, CATEGORIES, CATEGORY_BY_ID, AUTO_DELAY, REPORT_REASONS, REPORT_NOTE_MAX, pointsFor, secondsFor,
} from '/shared/config.js';
import { render as renderVisual, preload, isPreloaded, fetchNow, MISSING_HTML, loadLocalImages } from './visuals.js';
import { signSvg } from './signs.js';
import { ICONS } from './icons.js';
import { api, esc, shuffle, timeAgo, reduceMotion } from './util.js';

const app = document.getElementById('app');
const state = { config: null, user: null, settings: null, stats: null, lastRound: null };
let cleanup = () => {};
let navId = 0; // bumps on every screen change; async screens check it before drawing

const CAT_COUNT = Object.fromEntries(CATEGORIES.map((c) => [c.id, QUESTIONS.filter((q) => q.cat === c.id).length]));

// ── Boot & routing ─────────────────────────────────────────────

async function boot() {
  try {
    const [config, me] = await Promise.all([api('/api/config'), api('/api/me'), loadLocalImages()]);
    state.config = config;
    state.user = me.user;
    adoptSettings(me.settings);
  } catch (err) {
    // 503: the server is full (too many players at once); anything else: it's unreachable.
    const msg = err.status === 503 ? err.message : "Can't reach the Smarts server. Check that it's running, then reload.";
    app.innerHTML = `<section class="screen center-screen"><p class="error-text">${esc(msg)}</p></section>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
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
  window.scrollTo(0, 0);
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
  const demoOptions = ['Stop', 'Give way', 'Priority road'];
  app.innerHTML = `
    <section class="screen signin">
      <div class="signin-hero" aria-hidden="true">
        <div class="demo-card">
          <div class="demo-fuse"><span></span></div>
          <div class="demo-pic">${signSvg('give-way')}</div>
          <ul class="demo-options">
            ${demoOptions.map((o) => `<li class="${o === 'Give way' ? 'is-correct' : ''}">${o}</li>`).join('')}
          </ul>
        </div>
      </div>
      <div class="signin-copy">
        <h1 class="logo logo-xl">Smarts</h1>
        <p class="lede">A picture quiz for your pocket. ${QUESTIONS.length} questions in ${CATEGORIES.length} topics, from flags and country shapes to dog breeds and code. You get ${MODES[DEFAULT_MODE].secondsPerQuestion} seconds for each.</p>
      </div>
      <div class="signin-actions">
        ${googleClientId ? `<div id="google-btn" class="google-btn"></div>` : ''}
        ${!googleClientId ? `<p class="note">Google sign-in isn't set up yet. Add your <code>GOOGLE_CLIENT_ID</code> to <code>.env</code> (see the README).</p>` : ''}
        ${devLogin ? `
          <form class="dev-login" autocomplete="off">
            <label for="dev-name">${googleClientId ? 'Or play locally with just a name' : 'Play locally with just a name'}</label>
            <div class="dev-row">
              <input id="dev-name" name="name" maxlength="40" placeholder="Your name" required>
              <button class="btn btn-paper" type="submit">Continue</button>
            </div>
          </form>` : ''}
        <p class="error-text" id="signin-error" hidden></p>
        <p class="signin-legal"><a href="/privacy">Privacy policy</a></p>
      </div>
    </section>`;

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
      signedIn(user, settings);
    } catch (err) {
      showError(err.message);
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
    s.onerror = () => reject(new Error("Couldn't load Google sign-in. Check your connection and reload."));
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
          const { user, settings } = await api('/api/auth/google', { method: 'POST', body: { credential } });
          signedIn(user, settings);
        } catch (err) {
          showError(err.message);
        }
      },
    });
    const el = document.getElementById('google-btn');
    if (!el) return;
    google.accounts.id.renderButton(el, {
      theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'center',
      width: Math.min(360, Math.max(240, el.clientWidth)),
    });
  } catch (err) {
    showError(err.message);
  }
}

function signedIn(user, settings) {
  state.user = user;
  adoptSettings(settings);
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
  const ok = window.confirm('Delete your Smarts account? All your rounds, answers, statistics and settings are removed for good. This cannot be undone.');
  if (!ok) return;
  btn.disabled = true;
  try {
    await api('/api/account', { method: 'DELETE' });
  } catch (err) {
    btn.disabled = false;
    window.alert(`Your account could not be deleted: ${err.message}`);
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
        <h2 id="report-title">Report this question</h2>
        <p class="report-q">${esc(q.prompt)} <strong>Answer: ${esc(q.answer)}</strong></p>
        <fieldset class="report-reasons">
          <legend>What's wrong with it?</legend>
          ${reasons.map((r) => `<label class="report-reason"><input type="radio" name="reason" value="${r.id}"><span>${esc(r.label)}</span></label>`).join('')}
        </fieldset>
        <label class="report-note">
          <span>Anything to add? <small>Optional</small></span>
          <textarea name="note" rows="2" maxlength="${REPORT_NOTE_MAX}" placeholder="For example, what the right answer should be"></textarea>
        </label>
        <p class="report-error" role="alert" hidden></p>
        <div class="sheet-actions">
          <button type="button" class="btn btn-ghost-ink" data-report-cancel>Cancel</button>
          <button type="submit" class="btn btn-marigold" data-report-send>Send report</button>
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
        error.textContent = "Pick what's wrong first.";
        error.hidden = false;
        return;
      }
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      try {
        await api('/api/reports', { method: 'POST', body: { questionId: q.id, reason, note: form.elements.note.value } });
        close(true);
      } catch (err) {
        error.textContent = `Couldn't send it: ${err.message}`;
        error.hidden = false;
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send report';
      }
    });
    scrim.querySelector('input[name="reason"]').focus();
  });
}

const REPORT_BTN = `<button class="icon-btn report-btn" data-report aria-label="Report this question" title="Report this question">${ICONS.report}</button>`;

const reportedIds = new Set(); // questions reported during this visit

/** Turns a report button into a "reported" mark. */
function markReported(btn, q) {
  if (q) reportedIds.add(q.id);
  btn.disabled = true;
  btn.classList.add('is-done');
  btn.setAttribute('aria-label', 'Reported, thanks');
  btn.title = 'Reported, thanks';
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
      <a href="#/" class="${active === 'home' ? 'is-active' : ''}" ${active === 'home' ? 'aria-current="page"' : ''}>${ICONS.play}<span>Play</span></a>
      <a href="#/progress" class="${active === 'progress' ? 'is-active' : ''}" ${active === 'progress' ? 'aria-current="page"' : ''}>${ICONS.chart}<span>Progress</span></a>
    </nav>`;
}

// ── Home ───────────────────────────────────────────────────────

// New players get an animated "Tap to play!" hint on the Quick round card for their first
// few visits to the home screen. Counted on this device, per player.
const QUICK_HINT_VISITS = 5;

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
  const hint = takeQuickHint(user.id); // once per visit, though the screen is drawn twice
  const draw = (stats) => {
    const mastered = Object.fromEntries((stats?.byCategory || []).map((c) => [c.category, c.mastered]));
    const totalMastered = stats ? stats.masteredIds.length : 0;
    app.innerHTML = `
      <section class="screen home has-tabbar">
        <header class="topbar">
          <span class="logo">Smarts</span>
          <a href="#/progress" class="avatar-link" aria-label="Your progress">${avatar(user)}</a>
        </header>

        <h1 class="greeting">Hi ${firstName}</h1>
        <p class="sub">${stats ? `${totalMastered} of ${QUESTIONS.length} questions answered right so far.` : '&nbsp;'}</p>

        <a class="quick ${hint ? 'is-hinting' : ''}" href="#/play/mixed">
          ${hint ? '<span class="quick-hint" aria-hidden="true">Tap to play!</span>' : ''}
          <span class="quick-text">
            <strong>Quick round</strong>
            <span>${MODES[DEFAULT_MODE].questionsPerRound} questions, mixed topics</span>
          </span>
          <span class="quick-go" aria-hidden="true"><span>Play</span>${ICONS.play}</span>
        </a>

        <h2 class="section-title">Topics</h2>
        <ul class="topics">
          ${CATEGORIES.map((c) => {
            const m = mastered[c.id] || 0;
            const total = CAT_COUNT[c.id];
            return `
              <li>
                <a class="topic" href="#/play/${c.id}" style="--hue:${c.hue}">
                  <span class="topic-icon">${ICONS[c.id]}</span>
                  <span class="topic-text">
                    <strong>${esc(c.name)}</strong>
                    <span>${esc(c.blurb)}</span>
                  </span>
                  <span class="topic-meter" aria-label="${m} of ${total} answered right">
                    <span class="topic-count">${m}<small>/${total}</small></span>
                    <span class="meter"><span style="width:${(m / total) * 100}%"></span></span>
                  </span>
                </a>
              </li>`;
          }).join('')}
        </ul>
      </section>
      ${tabbar('home')}`;
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
  cat === 'mixed' ? 'Quick round' : cat === 'review' ? 'Review round' : esc(CATEGORY_BY_ID[cat]?.name || cat);

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
  // Book topics are only played from their own tile, never in a Quick round.
  const pool = (cat === 'mixed' ? QUESTIONS.filter((q) => !CATEGORY_BY_ID[q.cat]?.book) : QUESTIONS.filter((q) => q.cat === cat))
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
        <button class="icon-btn" data-quit aria-label="Quit round">${ICONS.close}</button>
        <ol class="pips" aria-label="${title} progress">
          ${round.questions.map(() => '<li></li>').join('')}
        </ol>
        <button class="auto-toggle" data-auto aria-haspopup="dialog" aria-expanded="false">
          <span class="auto-switch" aria-hidden="true"></span><span class="auto-label" data-auto-label></span>
        </button>
        <span class="play-score" aria-label="Score"><span data-score>0</span></span>
      </header>
      <div class="fuse-row">
        <div class="fuse" role="timer" aria-label="Time left"><span class="fuse-fill"></span><span class="fuse-spark"></span></div>
        <span class="fuse-secs" data-secs>${cfg.secondsPerQuestion}</span>
      </div>
      <div class="stage" data-stage></div>
      <p class="paused-note" data-paused-note hidden>Paused. The question is hidden until you come back.</p>
      <div class="dock" data-dock hidden></div>
      <div class="sheet-scrim" data-auto-sheet hidden>
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="auto-title">
          <h2 id="auto-title">Auto next</h2>
          <p>The game is paused while this is open.</p>
          <label class="setting">
            <span><strong>Move on by itself</strong><span>Off means you tap Next after each answer.</span></span>
            <input type="checkbox" class="switch" data-auto-on>
          </label>
          <div class="setting setting-range" data-auto-delay-row>
            <label for="play-delay"><strong>Wait before next question</strong><span>Takes effect from the next answer.</span></label>
            <div class="range-row">
              <input type="range" id="play-delay" min="${AUTO_DELAY.min}" max="${AUTO_DELAY.max}" step="1" data-auto-delay>
              <output for="play-delay" data-auto-delay-out></output>
            </div>
          </div>
          <button class="btn btn-marigold btn-block sheet-done" data-auto-done>Done</button>
        </div>
      </div>
      <div class="sheet-scrim" data-sheet hidden>
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="quit-title">
          <h2 id="quit-title">Quit this round?</h2>
          <p data-quit-note></p>
          <div class="sheet-actions">
            <button class="btn btn-ghost-ink" data-keep>Keep playing</button>
            <button class="btn btn-coral" data-confirm-quit>Quit round</button>
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
    fuseSpark.style.left = `${f * 100}%`;
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
             <p class="qcard-source">${esc(topic.name)}${topic.book ? `, by ${esc(topic.blurb)}` : ''}</p>
             <p class="qcard-text" id="prompt">${esc(q.prompt)}</p>
           </div>`
        : `<figure class="pic pic-${q.visual.type}">${vis.html}<p class="pic-loading" hidden>Loading picture…</p></figure>
           <p class="prompt" id="prompt">${esc(q.prompt)}</p>`;
    stage.innerHTML = `
      ${head}
      <div class="answers is-waiting" role="group" aria-labelledby="prompt">
        ${options.map((o, i) => `<button class="answer" data-i="${i}" disabled><kbd>${i + 1}</kbd><span>${esc(o)}</span></button>`).join('')}
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
      if (pic) pic.outerHTML = `<div class="vis vis-photo">${MISSING_HTML}</div>`;
      current.answered = true;
      current.outcome = 'skipped';
      round.results.push({ q, choice: null, correct: false, ms: 0, points: 0, skipped: true });
      pips[round.idx].classList.add('is-skipped');
      showDock(`<p class="dock-msg">No picture, so this one won't count.</p>${REPORT_BTN}<button class="btn btn-marigold btn-next" data-next><span>Skip</span></button>`);
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
    const long = q.answer.length > 22;
    const ans = `<b class="${long ? 'is-long' : ''}">${esc(q.answer)}</b>`;
    const msg = correct
      ? `<p class="dock-msg is-right">${ICONS.check}<span>Right. <b>+${points}</b></span></p>`
      : choice === null
        ? `<p class="dock-msg is-wrong">${ICONS.clock}<span>Out of time. ${long ? 'Answer:' : "It's"} ${ans}${long ? '' : '.'}</span></p>`
        : `<p class="dock-msg is-wrong">${ICONS.cross}<span>${long ? 'Answer:' : "It's"} ${ans}${long ? '' : '.'}</span></p>`;
    const last = round.idx === round.questions.length - 1;
    showDock(`${msg}${REPORT_BTN}<button class="btn btn-marigold btn-next" data-next><span>${last ? 'See results' : 'Next'}</span></button>`);

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
    $('[data-auto-label]').textContent = on ? `Auto ${secs}s` : 'Auto off';
    autoBtn.setAttribute('aria-label', on ? `Auto next on, ${secs} seconds. Change` : 'Auto next off. Change');
    autoOn.checked = on;
    autoDelay.value = String(secs);
    autoDelay.disabled = !on;
    autoDelayRow.classList.toggle('is-off', !on);
    autoDelayOut.textContent = `${secs} s`;
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
    $('[data-quit-note]').textContent = done
      ? `The ${done} ${done === 1 ? 'answer' : 'answers'} you gave will still count toward your progress.`
      : "You haven't answered anything yet, so nothing will be saved.";
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
    record.error = err.status === 401 ? 'you were signed out. Sign in again, then retry.' : err.message;
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
  const verdict =
    !counted.length ? 'No pictures loaded, so nothing was scored.'
      : right === counted.length ? 'A perfect round.'
      : right >= counted.length * 0.8 ? 'Sharp.'
        : right >= counted.length * 0.5 ? 'Solid round.'
          : 'Every miss is one to learn.';

  app.innerHTML = `
    <section class="screen results">
      <header class="topbar">
        <span class="logo">Smarts</span>
        <span class="results-topic">${title}</span>
      </header>

      <div class="score-hero">
        <p class="score-big">${r.score}</p>
        <p class="score-line"><b>${right} of ${counted.length}</b> right. ${verdict}</p>
        <dl class="score-facts">
          <div><dt>Best run</dt><dd>${r.bestStreak}</dd></div>
          <div><dt>Avg. time when right</dt><dd>${avg ? `${avg}s` : '–'}</dd></div>
        </dl>
        <p class="save-state ${r.error ? 'is-error' : ''}">
          ${r.error ? `This round wasn't saved: ${esc(r.error)}` : r.saved ? 'Saved to your progress.' : counted.length ? 'Saving…' : ''}
        </p>
        ${r.error ? '<button class="btn btn-ghost" data-retry>Try saving again</button>' : ''}
      </div>

      <div class="results-actions">
        <a class="btn btn-marigold btn-block" href="#/play/${r.cat}" data-again>Play again</a>
        <a class="btn btn-ghost btn-block" href="#/">Back to topics</a>
      </div>

      <h2 class="section-title">Your answers</h2>
      <ol class="review">
        ${r.results.map((x, i) => `
          <li class="${x.skipped ? 'is-skipped' : x.correct ? 'is-right' : 'is-wrong'}">
            <span class="review-mark">${x.skipped ? '–' : x.correct ? ICONS.check : ICONS.cross}</span>
            <span class="review-text">
              <strong>${esc(x.q.answer)}</strong>
              <span>${x.skipped ? 'Skipped, picture missing' : x.correct ? `${(x.ms / 1000).toFixed(1)}s, +${x.points}` : x.choice ? `You said ${esc(x.choice)}` : 'Ran out of time'}</span>
            </span>
            <span class="review-cat">${ICONS[x.q.cat]}</span>
            <button class="review-report" data-report-i="${i}" aria-label="Report this question" title="Report this question">${ICONS.report}</button>
          </li>`).join('')}
      </ol>
    </section>`;

  app.querySelector('[data-retry]')?.addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Saving…';
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
  app.innerHTML = `<section class="screen progress has-tabbar"><header class="topbar"><span class="logo">Smarts</span></header><p class="sub">Loading your progress…</p></section>${tabbar('progress')}`;
  const nav = navId;
  let s;
  try {
    s = await loadStats(true);
    if (nav !== navId) return;
  } catch (err) {
    if (nav !== navId) return;
    if (err.status === 401) return signOut();
    app.querySelector('.sub').textContent = `Couldn't load your progress: ${err.message}`;
    return;
  }

  const acc = s.answered ? Math.round((s.correct / s.answered) * 100) : 0;
  const byCat = Object.fromEntries(s.byCategory.map((c) => [c.category, c]));
  const maxDay = Math.max(1, ...s.days.map((d) => d.answered));
  const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  const empty = !s.answered;
  const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
  const duration = (ms) => {
    const m = Math.round(ms / 60000);
    if (m < 1) return `${Math.round(ms / 1000)} s`;
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  };
  const pct = (w) => (w.answered ? Math.round((w.correct / w.answered) * 100) : null);
  const weekNow = pct(s.thisWeek);
  const weekBefore = pct(s.lastWeek);
  const weekChange =
    weekNow === null ? 'No answers yet this week.'
      : weekBefore === null ? 'Nothing to compare with from the week before.'
        : weekNow === weekBefore ? 'Same accuracy as the week before.'
          : `Accuracy ${weekNow > weekBefore ? 'up' : 'down'} ${Math.abs(weekNow - weekBefore)} points on the week before.`;

  // Strongest and weakest topics, once a topic has enough answers to judge.
  const judged = s.byCategory
    .filter((c) => CATEGORY_BY_ID[c.category] && c.answered >= 5)
    .map((c) => ({ ...c, acc: Math.round((c.correct / c.answered) * 100) }))
    .sort((a, b) => b.acc - a.acc);
  const strongest = judged[0];
  const weakest = judged.length > 1 ? judged.at(-1) : null;

  const toReview = s.missed.filter((m) => QUESTION_BY_ID.has(m.id)).slice(0, 6);
  const reviewLabel = (q) => (q.visual.type === 'text' || q.ownPrompt ? q.prompt : CATEGORY_BY_ID[q.cat]?.name || '');

  app.innerHTML = `
    <section class="screen progress has-tabbar">
      <header class="topbar">
        <span class="logo">Smarts</span>
        ${avatar(user)}
      </header>

      <h1 class="greeting">Your progress</h1>

      ${empty ? `
        <div class="panel empty">
          <p><strong>Nothing here yet.</strong> Play a round and your answers start counting.</p>
          <a class="btn btn-marigold" href="#/play/mixed">Play a quick round</a>
        </div>` : `
        <div class="panel hero-panel">
          <p class="hero-num">${s.correct}</p>
          <p class="hero-label">answers right out of ${s.answered}, <b>${acc}%</b> accuracy</p>
          <div class="acc-bar" aria-hidden="true"><span style="width:${acc}%"></span></div>
        </div>

        <dl class="facts">
          <div><dt>Day streak</dt><dd>${s.dayStreak}<small> ${s.dayStreak === 1 ? 'day' : 'days'}</small></dd><p>Best: ${s.bestDayStreak}</p></div>
          <div><dt>Questions mastered</dt><dd>${s.masteredIds.length}<small>/${QUESTIONS.length}</small></dd><p>${Math.round((s.masteredIds.length / QUESTIONS.length) * 100)}% of all questions</p></div>
          <div><dt>Rounds played</dt><dd>${s.rounds}</dd><p>${s.perfectRounds} perfect</p></div>
          <div><dt>Best round</dt><dd>${s.bestScore}</dd><p>Average: ${s.avgScore}</p></div>
          <div><dt>Most right in a row</dt><dd>${s.bestStreak}</dd><p>Now: ${s.currentStreak}</p></div>
          <div><dt>Average time when right</dt><dd>${s.avgCorrectMs ? secs(s.avgCorrectMs) : '–'}</dd><p>Fastest: ${s.fastestMs ? secs(s.fastestMs) : '–'}</p></div>
          <div><dt>Time played</dt><dd>${duration(s.totalMs)}</dd><p>${s.answered} answers</p></div>
          <div><dt>Ran out of time</dt><dd>${s.timeouts}</dd><p>${s.answered ? Math.round((s.timeouts / s.answered) * 100) : 0}% of answers</p></div>
        </dl>

        <div class="panel">
          <h2 class="panel-title">This week</h2>
          <div class="weeks">
            <div><span class="week-num">${weekNow === null ? '–' : `${weekNow}%`}</span><span>right this week, ${s.thisWeek.answered} answers</span></div>
            <div><span class="week-num is-muted">${weekBefore === null ? '–' : `${weekBefore}%`}</span><span>the week before, ${s.lastWeek.answered} answers</span></div>
          </div>
          <p class="week-change">${weekChange}</p>
        </div>

        ${strongest ? `
          <div class="panel">
            <h2 class="panel-title">Strongest and weakest</h2>
            <ul class="extremes">
              <li style="--hue:${CATEGORY_BY_ID[strongest.category].hue}"><span class="cat-icon">${ICONS[strongest.category]}</span><span><strong>${esc(CATEGORY_BY_ID[strongest.category].name)}</strong><span>Your best topic, ${strongest.acc}% right</span></span></li>
              ${weakest && weakest.category !== strongest.category ? `<li style="--hue:${CATEGORY_BY_ID[weakest.category].hue}"><span class="cat-icon">${ICONS[weakest.category]}</span><span><strong>${esc(CATEGORY_BY_ID[weakest.category].name)}</strong><span>Needs the most practice, ${weakest.acc}% right</span></span></li>` : ''}
            </ul>
          </div>` : ''}

        <div class="panel">
          <h2 class="panel-title">Last 14 days</h2>
          <div class="days" role="img" aria-label="Answers per day over the last 14 days">
            ${s.days.map((d) => `
              <span class="day" title="${fmtDay(d.date)}: ${d.correct} of ${d.answered} right">
                <span class="day-bar" style="height:${(d.answered / maxDay) * 100}%"><span style="height:${d.answered ? (d.correct / d.answered) * 100 : 0}%"></span></span>
              </span>`).join('')}
          </div>
          <div class="days-axis"><span>${fmtDay(s.days[0].date)}</span><span>Today</span></div>
          <p class="legend"><span class="sw sw-right"></span>Right <span class="sw sw-all"></span>Answered</p>
        </div>`}

      <div class="panel">
        <h2 class="panel-title">By topic</h2>
        <ul class="cat-stats">
          ${CATEGORIES.map((c) => {
            const x = byCat[c.id] || { answered: 0, correct: 0, mastered: 0 };
            const total = CAT_COUNT[c.id];
            const a = x.answered ? Math.round((x.correct / x.answered) * 100) : null;
            return `
              <li style="--hue:${c.hue}">
                <span class="cat-icon">${ICONS[c.id]}</span>
                <span class="cat-body">
                  <span class="cat-head"><strong>${esc(c.name)}</strong><span>${x.mastered}/${total} mastered</span></span>
                  <span class="meter meter-ink"><span style="width:${(x.mastered / total) * 100}%"></span></span>
                  <span class="cat-acc">${a === null ? 'Not played yet' : `${a}% right over ${x.answered} ${x.answered === 1 ? 'answer' : 'answers'}${x.avgMs ? `, ${secs(x.avgMs)} when right` : ''}`}</span>
                </span>
              </li>`;
          }).join('')}
        </ul>
      </div>

      ${toReview.length ? `
        <div class="panel">
          <h2 class="panel-title">Questions you miss most</h2>
          <ul class="review-list">
            ${toReview.map((m) => {
              const q = QUESTION_BY_ID.get(m.id);
              return `
                <li>
                  <span class="cat-icon" style="--hue:${CATEGORY_BY_ID[q.cat]?.hue}">${ICONS[q.cat] || ICONS.mixed}</span>
                  <span class="review-body">
                    <span class="review-q">${esc(reviewLabel(q))}</span>
                    <strong>${esc(q.answer)}</strong>
                    <span class="review-count">Missed ${m.wrong} ${m.wrong === 1 ? 'time' : 'times'}${m.right ? `, right ${m.right}` : ''}</span>
                  </span>
                </li>`;
            }).join('')}
          </ul>
          <a class="btn btn-marigold btn-block" href="#/play/review">Practise these</a>
        </div>` : ''}

      ${s.recent.length ? `
        <div class="panel">
          <h2 class="panel-title">Recent rounds</h2>
          <ul class="recent">
            ${s.recent.map((r) => `
              <li>
                <span class="recent-icon">${ICONS[r.category] || ICONS.mixed}</span>
                <span class="recent-text"><strong>${roundTitle(r.category)}</strong><span>${timeAgo(r.created_at)}, ${r.correct}/${r.total} right</span></span>
                <span class="recent-score">${r.score}</span>
              </li>`).join('')}
          </ul>
        </div>` : ''}

      <div class="panel settings">
        <h2 class="panel-title">Settings</h2>
        <label class="setting">
          <span><strong>Auto next</strong><span>Move to the next question by itself after each answer. Turn off to tap Next yourself.</span></span>
          <input type="checkbox" class="switch" data-setting="autoNext" ${autoNextOn() ? 'checked' : ''}>
        </label>
        <div class="setting setting-range ${autoNextOn() ? '' : 'is-off'}" data-delay-row>
          <label for="auto-delay"><strong>Wait before next question</strong><span>How long the answer stays on screen. You can also change it during a game with the Auto button.</span></label>
          <div class="range-row">
            <input type="range" id="auto-delay" min="${AUTO_DELAY.min}" max="${AUTO_DELAY.max}" step="1" value="${autoDelaySeconds()}" ${autoNextOn() ? '' : 'disabled'} aria-describedby="auto-delay-out">
            <output id="auto-delay-out" for="auto-delay">${autoDelaySeconds()} s</output>
          </div>
        </div>
      </div>

      <div class="account">
        <p>Signed in as <strong>${esc(user.name)}</strong>${user.email ? ` (${esc(user.email)})` : user.provider === 'dev' ? ' with a local name' : ''}</p>
        <button class="btn btn-ghost" data-signout>Sign out</button>
        <div class="account-links">
          ${user.admin ? '<a class="link-btn" href="#/admin">Review question reports</a>' : ''}
          <button class="link-btn" data-signout-all>Sign out on all devices</button>
          <a class="link-btn" href="/api/account/export" download>Download my data</a>
          <button class="link-btn link-danger" data-delete-account>Delete my account</button>
          <a class="link-btn" href="/privacy">Privacy policy</a>
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
    delayOut.textContent = `${secs} s`;
    setSetting('autoNextDelay', secs);
  });
}

// ── Admin: question reports ────────────────────────────────────

const REASON_LABEL = Object.fromEntries(REPORT_REASONS.map((r) => [r.id, r.label]));
const STATUS_TABS = [['open', 'Open'], ['fixed', 'Fixed'], ['dismissed', 'Dismissed']];

async function showAdmin(status = 'open') {
  if (!STATUS_TABS.some(([s]) => s === status)) status = 'open';
  const nav = navId;
  const tabs = STATUS_TABS.map(([s, label]) =>
    `<a class="admin-tab ${s === status ? 'is-active' : ''}" href="#/admin/${s}" ${s === status ? 'aria-current="page"' : ''}>${label}</a>`).join('');
  const frame = (body) => `
    <section class="screen admin has-tabbar">
      <header class="topbar"><span class="logo">Smarts</span></header>
      <h1 class="section-title">Question reports</h1>
      <nav class="admin-tabs" aria-label="Report status">${tabs}</nav>
      ${body}
    </section>
    ${tabbar('progress')}`;
  app.innerHTML = frame('<p class="sub">Loading reports…</p>');

  let reports;
  try {
    ({ reports } = await api(`/api/admin/reports?status=${status}`));
    if (nav !== navId) return;
  } catch (err) {
    if (nav !== navId) return;
    if (err.status === 401) return signOut();
    app.querySelector('.sub').textContent = `Couldn't load reports: ${err.message}`;
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
      ? `<p class="admin-meta">Photo: <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(q.visual.title.replace(/ /g, '_'))}" target="_blank" rel="noopener">${esc(q.visual.title)}</a></p>`
      : '';
    return `
      <article class="panel admin-card" data-qid="${esc(id)}">
        <p class="admin-meta">${topic ? `${ICONS[q.cat] || ''}<span>${esc(topic.name)}</span> · ` : ''}<code>${esc(id)}</code></p>
        ${q ? `
          <h2 class="admin-q">${esc(q.prompt)}</h2>
          <p class="admin-answers"><strong>${esc(q.answer)}</strong> · ${q.wrong.map(esc).join(' · ')}</p>
          ${photo}` : '<h2 class="admin-q">This question is no longer in the question bank.</h2>'}
        <ul class="admin-reasons">
          ${Object.entries(counts).map(([reason, n]) => `<li><b>${n}×</b> ${esc(REASON_LABEL[reason] || reason)}</li>`).join('')}
        </ul>
        ${notes.length ? `<ul class="admin-notes">${notes.map((r) => `<li>“${esc(r.note)}” <span>${esc(r.userName || 'Deleted account')}, ${timeAgo(r.created_at)}</span></li>`).join('')}</ul>` : ''}
        ${status === 'open'
          ? `<div class="admin-actions">
               <button class="btn btn-ghost-ink" data-resolve="dismissed">Dismiss</button>
               <button class="btn btn-marigold" data-resolve="fixed">Mark fixed</button>
             </div>`
          : `<p class="admin-meta">${status === 'fixed' ? 'Fixed' : 'Dismissed'} ${timeAgo(list[0].resolved_at)}</p>`}
      </article>`;
  };

  app.innerHTML = frame(groups.size
    ? `<p class="sub">${groups.size} ${groups.size === 1 ? 'question' : 'questions'}. Fix a question in <code>shared/questions.js</code>, then mark it fixed here.</p>${[...groups].map(card).join('')}`
    : `<p class="sub">No ${status} reports.</p>`);

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
        window.alert(`Couldn't update the report: ${err.message}`);
      }
    });
  });
}

boot();
