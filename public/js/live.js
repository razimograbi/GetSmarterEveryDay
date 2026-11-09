// A live duel in the browser. The server (server/match.js) runs the match and says where it
// stands; this file only shows that and passes on what the player does.
//
// Messages arrive over one long-lived connection (Server-Sent Events). Each is the player's whole
// view of the match with a version number, so nothing depends on any one message arriving. If
// the connection goes quiet this reconnects, and asks for the state directly in the meantime.

import { CATEGORY_BY_ID, MATCH } from '/shared/config.js';
import { render as renderVisual, preload } from './visuals.js';
import { ICONS } from './icons.js';
import { api, esc, reduceMotion } from './util.js';
import { t, qt, catName, catBlurb } from './i18n.js';

const QUIET_POLL_MS = 7000; // nothing heard for this long: ask directly, and say we're reconnecting
const QUIET_RECONNECT_MS = 12_000; // nothing heard for this long: the connection is dead
const POLL_EVERY_MS = 2000;
const READY_WAIT_MS = 2500; // a picture still loading after this doesn't hold the other player up any more

const BOLT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (promise, ms) => Promise.race([promise, wait(ms).then(() => 'late')]);
const nameOf = (p) => (p?.name ? `<bdi>${esc(p.name)}</bdi>` : esc(t('people.hidden')));

/** Starts showing the duel `id` in `app`. Returns what to call to stop. */
export function playLive(app, id, ctx) {
  const stream = `/api/duels/${encodeURIComponent(id)}`;
  const slots = new Map(); // question number -> what's known about it; its id keeps pictures cached across phases

  let alive = true;
  let s = null; // the latest view of the match
  let lastV = -1;
  let es = null;
  let replaced = false;
  let lastHeard = performance.now();
  let lastConnect = 0;
  let lastPoll = 0;
  let lastBeat = performance.now();
  let raf = 0;
  let phaseEnd = 0;
  let fuseEnd = 0;
  let fuseLimit = 1;
  let shownCount = 0;
  let cur = null; // the question on screen: { idx, q, options, answered, choice }
  let shownScore = 0;
  let countUp = 0;
  let timers = [];
  let ui = null; // the play screen's elements, once it's up
  let lobbyUp = false;
  let startedTracked = false;
  let guarded = false;
  let exiting = false;

  // ── Talking to the server ──

  function trouble(err) {
    if (!alive) return false;
    if (err.status === 401) {
      ctx.signOut();
      return true;
    }
    if (err.status === 404 || err.status === 403) {
      exit();
      return true;
    }
    return false;
  }

  function send(action, body = {}) {
    return api(`${stream}/${action}`, { method: 'POST', body }).then(apply);
  }

  const say = (action, body) => send(action, body).catch(trouble);

  /** Tells the server the app is in the background. It has to get out while the page is being hidden. */
  const sayAway = () => api(`${stream}/away`, { method: 'POST', keepalive: true }).then(apply).catch(trouble);

  /** Keeps trying until it gets through or the question has moved on. */
  async function sendAnswer(idx, choice, away) {
    for (let attempt = 0; alive && s?.phase === 'answer' && s.idx === idx; attempt++) {
      try {
        return await send('answer', { idx, choice, away });
      } catch (err) {
        if (trouble(err) || (err.status && err.status < 500 && err.status !== 429)) return;
        await wait(Math.min(2000, 300 * 2 ** attempt));
      }
    }
  }

  function heard() {
    lastHeard = performance.now();
  }

  function connect() {
    es?.close();
    lastConnect = performance.now();
    es = new EventSource(`${stream}/stream`);
    es.addEventListener('state', (e) => {
      heard();
      apply(JSON.parse(e.data));
    });
    es.addEventListener('ping', heard);
    es.addEventListener('replaced', () => {
      replaced = true;
      es.close();
      showReplaced();
    });
    es.addEventListener('gone', () => exit());
  }

  function poll() {
    lastPoll = performance.now();
    api(`${stream}/state`).then(apply, trouble);
  }

  /** Once a second: keeps the connection honest and tells the server we're still here. */
  function watchdog() {
    if (!alive || replaced) return;
    const now = performance.now();
    const quiet = now - lastHeard;
    if ((es?.readyState === EventSource.CLOSED && now - lastConnect > 2000) || (quiet > QUIET_RECONNECT_MS && now - lastConnect > QUIET_RECONNECT_MS)) connect();
    if (quiet > QUIET_POLL_MS && now - lastPoll >= POLL_EVERY_MS) poll();
    if (!document.hidden && now - lastBeat >= MATCH.beatEveryMs) {
      lastBeat = now;
      say('beat');
    }
    showBanner();
  }

  // ── Showing where the match stands ──

  function apply(next) {
    if (!alive || !next || replaced) return;
    if (next.left) return exit();
    if (next.v < lastV) return;
    if (next.v === lastV) return resync(next);
    const prev = s;
    s = next;
    lastV = next.v;
    phaseEnd = performance.now() + next.remainingMs;
    for (const { idx, visual } of next.previews || []) {
      const slot = slotOf(idx);
      slot.visual ??= visual;
      if (idx > next.idx || next.phase === 'countdown') preload(slot);
    }
    if (next.phase === 'done') return exit(next);
    if (next.phase === 'lobby') return showLobby(next);
    if (!startedTracked) {
      startedTracked = true;
      ctx.started();
    }
    showPlayScreen();
    const fresh = !prev || prev.phase !== next.phase || prev.idx !== next.idx;
    if (fresh) clearTimers();
    showThem(next);
    if (next.phase !== 'reveal') {
      setScore(next.you.score);
      showPips(next.you.results.length);
    }
    ui.count.hidden = next.phase !== 'countdown';
    ui.waiting.hidden = true;
    if (next.phase === 'prepare' && fresh) showPrepare(next);
    if (next.phase === 'answer') (fresh ? showAnswer(next) : showWaiting(next));
    if (next.phase === 'reveal' && fresh) showReveal(next);
    if (next.phase === 'void' && fresh) showVoid(next);
    showBanner();
  }

  /**
   * The same state again, as a reply or after a reconnect, with a fresher "time left". Messages
   * only ever arrive late, so the earliest end is the best estimate. This also puts the timers
   * right if the phone slept and the browser's clock stopped with it.
   */
  function resync(n) {
    const now = performance.now();
    phaseEnd = Math.min(phaseEnd, now + n.remainingMs);
    if (n.phase === 'answer') fuseEnd = Math.min(fuseEnd, now + n.clockMs);
  }

  function slotOf(idx) {
    if (!slots.has(idx)) slots.set(idx, { id: `live:${id}:${idx}`, slot: idx });
    return slots.get(idx);
  }

  function frame() {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (!s) return;
    const now = performance.now();
    if (s.phase === 'countdown' && ui) {
      const n = Math.max(1, Math.ceil((phaseEnd - now) / 1000));
      if (n !== shownCount) {
        shownCount = n;
        ui.countNum.textContent = n;
        ui.countNum.classList.remove('is-tick');
        void ui.countNum.offsetWidth;
        ui.countNum.classList.add('is-tick');
      }
    }
    if (s.phase === 'answer' && ui) {
      const left = Math.max(0, fuseEnd - now);
      setFuse(left / fuseLimit);
      ui.secs.textContent = Math.ceil(left / 1000);
      ui.fuseRow.classList.toggle('is-low', left <= 5000 && !cur?.answered);
      if (left <= 0 && cur && !cur.answered) choose(null);
    }
    if (s.phase === 'prepare' && s.holdMs) showBanner();
  }

  // ── The lobby ──

  function showLobby(n) {
    const host = n.you.side === 'challenger';
    const friend = host ? ctx.invitedFriend : n.them?.profile;
    if (!lobbyUp) {
      lobbyUp = true;
      app.innerHTML = `
        <section class="screen duel has-tabbar">
          ${ctx.topbar()}
          <p class="eyebrow on-cobalt">${esc(t('duel.title'))} · ${esc(ctx.topic(n.category))}</p>
          <div class="panel challenge-card">
            <div class="lobby-faces">
              ${ctx.coveredAvatar(n.you.profile, 84)}
              <span class="versus-vs">${esc(t('duel.vs'))}</span>
              ${friend?.avatar ? ctx.coveredAvatar(friend, 84) : '<span class="lobby-empty" aria-hidden="true">?</span>'}
            </div>
            <h1 class="challenge-title" data-lobby-title></h1>
            <div class="lobby-dots" aria-hidden="true"><span></span><span></span><span></span></div>
            <p class="challenge-sub" data-lobby-sub></p>
            ${host ? `
              <div class="share-row">
                <button class="btn btn-marigold" data-share>${ICONS.share}<span>${esc(t('duel.sendButton'))}</span></button>
                <button class="btn btn-ghost-ink" data-copy>${ICONS.copy}<span>${esc(t('share.copyLink'))}</span></button>
              </div>
              <p class="share-status" data-share-status aria-live="polite"></p>` : ''}
            <button class="btn btn-ghost-ink btn-block" data-lobby-leave>${esc(t(host ? 'live.cancel' : 'live.leaveLobby'))}</button>
          </div>
        </section>
        ${ctx.tabbar('friends')}`;
      const status = app.querySelector('[data-share-status]');
      app.querySelector('[data-share]')?.addEventListener('click', async () => ctx.shareStatus(status, await ctx.shareLink()));
      app.querySelector('[data-copy]')?.addEventListener('click', async () => ctx.shareStatus(status, await ctx.copyLink()));
      app.querySelector('[data-lobby-leave]').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        await send('leave').catch(() => {});
        if (alive) ctx.leftLobby();
      });
    }
    const title = host
      ? (friend?.name ? t('live.waitingFriend', { name: nameOf(friend) }) : esc(t('live.waitingRoom')))
      : t('live.waitingHost', { name: nameOf(n.them?.profile) });
    app.querySelector('[data-lobby-title]').innerHTML = title;
    app.querySelector('[data-lobby-sub]').textContent = t(!host ? 'live.waitingHostSub' : friend?.name ? 'live.friendHint' : 'live.shareHint');
  }

  // ── The play screen ──

  function showPlayScreen() {
    if (ui) return;
    armGuard();
    app.innerHTML = `
      <section class="screen play live-play">
        <header class="play-top">
          <button class="icon-btn" data-quit aria-label="${esc(t('play.quit'))}">${ICONS.close}</button>
          <ol class="pips" aria-label="${esc(t('play.progress', { title: t('duel.title') }))}">
            ${Array.from({ length: s.total }, () => '<li></li>').join('')}
          </ol>
          <span class="live-them" data-them>
            ${ctx.coveredAvatar(s.them?.profile, 32)}
            <span class="live-them-check" aria-hidden="true">${ICONS.check}</span>
          </span>
          <span class="play-score" aria-label="${esc(t('play.score'))}"><span data-score>${s.you.score}</span></span>
        </header>
        <div class="fuse-row is-waiting">
          <div class="fuse" role="timer" aria-label="${esc(t('play.timeLeft'))}"><span class="fuse-fill"></span><span class="fuse-spark"></span></div>
          <span class="fuse-secs" data-secs></span>
        </div>
        <p class="live-banner" data-banner aria-live="polite" hidden></p>
        <div class="stage" data-stage></div>
        <p class="live-waiting" data-waiting aria-live="polite" hidden></p>
        <div class="dock" data-dock hidden></div>
        <div class="live-count" data-count hidden>
          <div class="lobby-faces">
            ${ctx.coveredAvatar(s.you.profile, 84)}
            <span class="versus-vs">${esc(t('duel.vs'))}</span>
            ${ctx.coveredAvatar(s.them?.profile, 84)}
          </div>
          <p class="live-count-topic">${esc(ctx.topic(s.category))}</p>
          <span class="live-count-num" data-count-num></span>
          <p class="live-count-hint">${esc(t('live.getReady'))}</p>
        </div>
        <div class="sheet-scrim" data-sheet hidden>
          <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="live-quit-title">
            <h2 id="live-quit-title">${esc(t('live.quitTitle'))}</h2>
            <p>${esc(t('live.quitNote'))}</p>
            <div class="sheet-actions">
              <button class="btn btn-ghost-ink" data-keep>${esc(t('quit.keep'))}</button>
              <button class="btn btn-coral" data-confirm-quit>${esc(t('quit.confirm'))}</button>
            </div>
          </div>
        </div>
      </section>`;
    const $ = (sel) => app.querySelector(sel);
    ui = {
      stage: $('[data-stage]'), dock: $('[data-dock]'), pips: [...app.querySelectorAll('.pips li')], score: $('[data-score]'),
      scoreBox: $('.play-score'), them: $('[data-them]'), fuseRow: $('.fuse-row'), fuseFill: $('.fuse-fill'), fuseSpark: $('.fuse-spark'),
      secs: $('[data-secs]'), banner: $('[data-banner]'), waiting: $('[data-waiting]'), count: $('[data-count]'), countNum: $('[data-count-num]'), sheet: $('[data-sheet]'),
    };
    shownScore = s.you.score;
  }

  const setFuse = (frac) => {
    const f = Math.max(0, Math.min(1, frac));
    ui.fuseFill.style.transform = `scaleX(${f})`;
    ui.fuseSpark.style.insetInlineStart = `${f * 100}%`; // left in English, right in Hebrew and Arabic
  };

  function showPips(done, current = s.idx) {
    ui.pips.forEach((p, i) => {
      const r = i < done ? s.you.results[i] : null;
      p.className = r ? (r.skipped ? 'is-skipped' : r.correct ? 'is-right' : 'is-wrong') : i === current && s.phase !== 'countdown' ? 'is-current' : '';
    });
  }

  function setScore(value) {
    cancelAnimationFrame(countUp);
    shownScore = value;
    ui.score.textContent = value;
  }

  /** The score climbs to its new value. */
  function climbScore(value) {
    cancelAnimationFrame(countUp);
    const from = shownScore;
    if (value === from) return;
    const began = performance.now();
    const step = () => {
      const f = Math.min(1, (performance.now() - began) / 420);
      ui.score.textContent = Math.round(from + (value - from) * f);
      if (f < 1) countUp = requestAnimationFrame(step);
      else shownScore = value;
    };
    ui.scoreBox.classList.remove('is-bump');
    void ui.scoreBox.offsetWidth;
    ui.scoreBox.classList.add('is-bump');
    countUp = requestAnimationFrame(step);
  }

  function showThem(n) {
    ui.them.classList.toggle('is-answered', !!n.them?.answered);
    ui.them.classList.toggle('is-away', n.them ? !n.them.connected : false);
  }

  /** "Reconnecting" about ourselves comes first; otherwise, whether we're waiting for the other player. */
  function showBanner() {
    if (!ui || !s) return;
    let text = '';
    if (performance.now() - lastHeard > QUIET_POLL_MS) text = esc(t('live.reconnecting'));
    else if (s.phase === 'prepare' && s.holdMs) text = t('live.holding', { name: nameOf(s.them?.profile), s: Math.max(0, Math.ceil((phaseEndOfHold() - performance.now()) / 1000)) });
    if (ui.banner.innerHTML !== text) ui.banner.innerHTML = text;
    ui.banner.hidden = !text;
  }

  // When a hold started, as this browser saw it.
  let holdSeen = null;
  function phaseEndOfHold() {
    if (holdSeen?.v !== s.v) holdSeen = { v: s.v, end: performance.now() + s.holdMs };
    return holdSeen.end;
  }

  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));

  /** Draws a question: the picture first, the words when `options` are known. Returns the picture. */
  function paintStage(q, idx) {
    const vis = renderVisual(q);
    const topic = CATEGORY_BY_ID[q.cat];
    const head = q.visual.type === 'text'
      ? `<div class="qcard" style="--hue:${topic.hue}">
           <p class="qcard-source">${esc(topic.book ? t('q.byAuthor', { topic: catName(topic), author: catBlurb(topic) }) : catName(topic))}</p>
           <p class="qcard-text" id="prompt"></p>
         </div>`
      : `<figure class="pic pic-${q.visual.type}">${vis.html}</figure>
         <p class="prompt" id="prompt"></p>`;
    ui.stage.innerHTML = `${head}<div class="answers is-waiting" role="group" aria-labelledby="prompt"></div>`;
    ui.stage.dataset.idx = idx;
    ui.stage.classList.remove('enter');
    void ui.stage.offsetWidth;
    ui.stage.classList.add('enter');
    window.scrollTo(0, 0);
    return vis;
  }

  function showPrepare(n) {
    const q = slotOf(n.idx);
    q.cat = n.cat;
    q.visual ??= n.visual;
    cur = null;
    ui.dock.hidden = true;
    ui.dock.innerHTML = '';
    ui.fuseRow.classList.remove('is-low', 'is-done');
    ui.fuseRow.classList.add('is-waiting');
    setFuse(1);
    ui.secs.textContent = '';
    const vis = paintStage(q, n.idx);
    const here = () => alive && s.phase === 'prepare' && s.idx === n.idx;
    (async () => {
      let r = await within(vis.ready(ui.stage), READY_WAIT_MS);
      if (!here()) return;
      if (r === false) {
        // One more go, in the time there is. If that fails too, this player loses the question.
        const retry = renderVisual(q);
        const pic = ui.stage.querySelector('.pic');
        pic?.querySelector('.vis')?.remove();
        pic?.insertAdjacentHTML('afterbegin', retry.html);
        r = await within(retry.ready(ui.stage), 1200);
        if (!here()) return;
      }
      say('ready', { idx: n.idx, failed: r === false });
    })();
  }

  function showAnswer(n) {
    say('seen', { idx: n.idx }); // first of all: this also measures the connection
    const q = slotOf(n.idx);
    Object.assign(q, { cat: n.question.cat, prompt: n.question.prompt });
    q.visual ??= n.question.visual;
    const local = ui.stage.dataset.idx === String(n.idx);
    if (!local) {
      const vis = paintStage(q, n.idx);
      vis.ready(ui.stage);
    }
    cur = { idx: n.idx, q, options: n.question.options, answered: n.answered, choice: n.choice ?? null };
    ui.stage.querySelector('#prompt').textContent = qt(q, q.prompt);
    const answers = ui.stage.querySelector('.answers');
    answers.innerHTML = cur.options.map((o, i) => `<button class="answer${n.answered && o === cur.choice ? ' is-picked' : ''}" data-i="${i}"${n.answered ? ' disabled' : ''}><kbd>${i + 1}</kbd><span>${esc(qt(q, o))}</span></button>`).join('');
    answers.classList.remove('is-waiting');
    ui.fuseRow.classList.remove('is-waiting');
    fuseLimit = n.question.seconds * 1000;
    fuseEnd = performance.now() + n.clockMs;
    showWaiting(n);
  }

  /** Once the player has answered, says who they're waiting for. Before that, nothing. */
  function showWaiting(n) {
    if (!cur?.answered) {
      ui.waiting.hidden = true;
      return;
    }
    const them = n.them?.profile;
    ui.waiting.innerHTML = `<span class="lobby-dots" aria-hidden="true"><span></span><span></span><span></span></span><span>${t(n.noPicture ? 'live.noPictureWait' : n.them?.connected ? 'live.waitingAnswer' : 'live.themAway', { name: nameOf(them) })}</span>`;
    ui.waiting.hidden = false;
  }

  function choose(choice, { away = false } = {}) {
    if (!cur || cur.answered || s?.phase !== 'answer') return;
    cur.answered = true;
    cur.choice = choice;
    ui.stage.querySelectorAll('.answer').forEach((b) => {
      b.disabled = true;
      if (cur.options[Number(b.dataset.i)] === choice) b.classList.add('is-picked');
    });
    ui.fuseRow.classList.remove('is-low');
    showWaiting(s);
    sendAnswer(cur.idx, choice, away);
  }

  function showReveal(n) {
    const r = n.result;
    ctx.learn({ q: r.question });
    const q = { ...slotOf(n.idx), cat: r.question.cat, prompt: r.question.prompt };
    q.visual ??= r.question.visual;
    let options = cur?.idx === n.idx ? cur.options : null;
    if (!options) {
      // Arrived in the middle of the reveal (a reload): draw the question first.
      options = r.question.options;
      if (ui.stage.dataset.idx !== String(n.idx)) paintStage(q, n.idx).ready(ui.stage);
      ui.stage.querySelector('#prompt').textContent = qt(q, r.question.prompt);
      const answers = ui.stage.querySelector('.answers');
      answers.classList.remove('is-waiting');
      answers.innerHTML = options.map((o, i) => `<button class="answer" data-i="${i}" disabled><kbd>${i + 1}</kbd><span>${esc(qt(q, o))}</span></button>`).join('');
    }
    cur = null;
    ui.fuseRow.classList.remove('is-low', 'is-waiting');
    ui.fuseRow.classList.add('is-done');
    ui.stage.querySelectorAll('.answer').forEach((b) => {
      const text = options[Number(b.dataset.i)];
      b.disabled = true;
      b.classList.remove('is-picked');
      if (text === r.answer) b.classList.add('is-correct');
      else if (text === r.choice) b.classList.add('is-wrong');
      else b.classList.add('is-dim');
    });
    if (!r.correct) navigator.vibrate?.(70);
    animateResult(n, q);
  }

  /**
   * How the player did, one beat at a time: right or wrong, then how fast they were, then the
   * points land on the score. Someone arriving late, or who asked for less motion, gets the end.
   */
  function animateResult(n, q) {
    const r = n.result;
    const instant = reduceMotion() || n.remainingMs < 2800;
    const shown = qt(q, r.answer);
    const long = shown.length > 22;
    const answer = `<b class="${long ? 'is-long' : ''}">${esc(shown)}</b>`;
    const reveal = t(long ? 'q.answerIs' : 'q.its', { answer });
    const [icon, verdict] = r.correct ? [ICONS.check, 'live.correct'] : r.noPicture ? [ICONS.cross, 'live.noPicture'] : r.away ? [ICONS.cross, 'live.away'] : r.choice === null ? [ICONS.clock, 'live.outOfTime'] : [ICONS.cross, 'live.wrong'];
    const limit = r.seconds * 1000;
    const mark = Math.max(0, Math.min(1, r.ms / limit));
    const hit = 2 - r.speed; // the zone the time landed in: 0 fast, 1 middle, 2 slow
    const zones = ['+2', '+1', '+0'];
    ui.dock.innerHTML = `
      <div class="lr ${r.correct ? 'is-right' : 'is-wrong'}${instant ? ' is-instant' : ''}">
        <div class="lr-top">
          <p class="lr-verdict" role="status">${icon}<span>${esc(t(verdict))}</span></p>
          <div class="lr-chips" dir="ltr">
            <span class="lr-chip is-base" data-chip>+${r.base}</span>
            ${r.speed ? `<span class="lr-chip is-speed" data-chip>${BOLT}<span dir="ltr">+${r.speed}</span></span>` : ''}
          </div>
        </div>
        ${r.correct ? `
          <div class="lr-speed" style="--mark:${mark.toFixed(3)}" aria-label="${esc(t('live.speed'))}">
            <div class="lr-track">
              ${zones.map((z, i) => `<span class="lr-zone" data-zone="${i}" dir="ltr">${z}</span>`).join('')}
              <i class="lr-marker"><b dir="ltr">${(r.ms / 1000).toFixed(1)}s</b></i>
            </div>
          </div>` : `<p class="lr-answer">${reveal}</p>`}
      </div>`;
    ui.dock.hidden = false;
    const box = ui.dock.querySelector('.lr');
    const chips = [...box.querySelectorAll('[data-chip]')];
    const finish = () => {
      climbScore(n.you.score);
      showPips(n.you.results.length, -1);
    };
    if (instant) {
      box.querySelector('.lr-speed')?.classList.add('is-go');
      box.querySelector(`[data-zone="${hit}"]`)?.classList.add('is-hit');
      chips.forEach((c) => c.classList.add('is-in'));
      setScore(n.you.score);
      showPips(n.you.results.length, -1);
      return;
    }
    showPips(n.you.results.length - 1, n.idx);
    if (!r.correct) {
      later(450, () => chips.forEach((c) => c.classList.add('is-in')));
      later(1000, finish);
      return;
    }
    later(300, () => box.querySelector('.lr-speed').classList.add('is-go'));
    later(1000, () => {
      box.querySelector(`[data-zone="${hit}"]`)?.classList.add('is-hit');
      chips[0]?.classList.add('is-in');
    });
    later(1280, () => chips[1]?.classList.add('is-in'));
    later(1950, () => {
      const target = ui.scoreBox.getBoundingClientRect();
      for (const chip of chips) {
        const from = chip.getBoundingClientRect();
        chip.style.setProperty('--dx', `${target.left + target.width / 2 - from.left - from.width / 2}px`);
        chip.style.setProperty('--dy', `${target.top + target.height / 2 - from.top - from.height / 2}px`);
        chip.classList.add('is-flying');
      }
    });
    later(2380, finish);
  }

  function showVoid(n) {
    cur = null;
    ui.stage.querySelectorAll('.answer').forEach((b) => { b.disabled = true; b.classList.add('is-dim'); });
    ui.fuseRow.classList.remove('is-low');
    ui.fuseRow.classList.add('is-done');
    ui.dock.innerHTML = `<p class="dock-msg">${esc(t(n.voidReason === 'restart' ? 'live.voidRestart' : 'live.voidPicture'))}</p>`;
    ui.dock.hidden = false;
  }

  function showReplaced() {
    if (raf) cancelAnimationFrame(raf);
    ui = null;
    lobbyUp = false;
    app.innerHTML = `
      <section class="screen duel center-screen">
        <div class="panel challenge-card">
          <p class="challenge-sub">${esc(t('live.replaced'))}</p>
          <button class="btn btn-marigold btn-block" data-here>${esc(t('live.playHere'))}</button>
        </div>
      </section>`;
    app.querySelector('[data-here]').addEventListener('click', () => {
      replaced = false;
      lastV = -1;
      s = null;
      heard();
      connect();
      say('beat');
      raf = requestAnimationFrame(frame);
    });
  }

  // ── Leaving ──

  /** The match is over here: the normal duel screen takes it from there. */
  function exit(n = null) {
    if (exiting || !alive) return;
    exiting = true;
    alive = false;
    stop();
    if (startedTracked && (n?.ended?.reason === 'played' || n?.ended?.reason === 'forfeit')) ctx.finished();
    if (guarded && history.state?.liveGuard) history.back(); // onPop then shows the next screen
    else ctx.refresh();
  }

  // A guard history entry, so the phone's Back gesture asks first instead of walking out of the match.
  function armGuard() {
    if (guarded) return;
    guarded = true;
    history.pushState({ liveGuard: true }, '', location.hash);
  }

  function openQuit() {
    if (ui) {
      ui.sheet.hidden = false;
      ui.sheet.querySelector('[data-keep]').focus();
    }
  }

  const closeQuit = () => { if (ui) ui.sheet.hidden = true; };

  const onPop = () => {
    if (exiting) return ctx.refresh();
    if (!alive || !guarded) return;
    history.pushState({ liveGuard: true }, '', location.hash);
    if (ui?.sheet.hidden) openQuit();
    else closeQuit();
  };

  const onClick = (e) => {
    const b = e.target.closest('button');
    if (!b || !ui) return;
    if (b.classList.contains('answer')) return cur && choose(cur.options[Number(b.dataset.i)]);
    if (b.hasAttribute('data-quit')) return openQuit();
    if (b.hasAttribute('data-keep')) return closeQuit();
    if (b.hasAttribute('data-confirm-quit')) {
      b.disabled = true;
      send('leave').catch(() => {}).finally(() => exit({ ended: { reason: 'forfeit' } }));
    }
  };

  const onKey = (e) => {
    if (!ui) return;
    if (!ui.sheet.hidden) {
      if (e.key === 'Escape') closeQuit();
      return;
    }
    if (e.key === 'Escape') return openQuit();
    if (cur && !cur.answered && /^[1-5]$/.test(e.key) && cur.options[Number(e.key) - 1] !== undefined) choose(cur.options[Number(e.key) - 1]);
  };

  const onVisibility = () => {
    if (document.hidden) {
      // Leaving the app with a question on screen counts as wrong, as in every server-run round:
      // time away can't go into looking the answer up.
      if (cur && !cur.answered && s?.phase === 'answer') choose(null, { away: true });
      if (!replaced) sayAway();
      return;
    }
    if (replaced) return;
    lastBeat = performance.now();
    say('beat');
    if (performance.now() - lastHeard > 3000) connect();
  };

  function stop() {
    es?.close();
    cancelAnimationFrame(raf);
    cancelAnimationFrame(countUp);
    clearInterval(dog);
    clearTimers();
    app.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibility);
    if (!exiting) window.removeEventListener('popstate', onPop);
  }

  app.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('popstate', onPop);
  const dog = setInterval(watchdog, 1000);
  connect();
  poll();
  if (document.hidden) sayAway();
  else say('beat'); // a reload after being away: nothing else would tell the server we're back
  raf = requestAnimationFrame(frame);

  return () => {
    if (!alive) {
      window.removeEventListener('popstate', onPop);
      return;
    }
    alive = false;
    stop(); // the match carries on on the server: the player can come back to it
  };
}
