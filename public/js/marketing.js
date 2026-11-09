// The Marketing Studio: edit one video, preview it in Arabic, English and Hebrew, and record all
// three with the same timing. The videos have no sound; the editors add it, once, using the timing
// sheet. Only the people in MARKETING_USERS reach this screen, and the server checks it too.
// It's an internal tool, so its own labels are in English; the videos are what get translated.

import { api, esc } from './util.js';
import { CATEGORY_BY_ID } from '/shared/config.js';
import {
  FORMATS, LANGS, SAFE_ZONE, TEMPLATES, clock, drawFrame, editSheetCsv, fitProblems, loadKit, normalizeProject,
  prepareImages, sceneText, shownUrl, soundCues, subtitlesSrt, timeline, videoQuestions,
} from './studio.js';

const FPS = 30;
const BITRATE = 16_000_000;
const RECORD_TYPES = ['video/mp4;codecs=avc1.640034', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
const SAVE_DELAY = 900;
const LENGTH_TOLERANCE_MS = 500;
const STALL_MS = 2000;
const STUTTER_MS = 300;
const STALLED = 'The recording stopped because the window stopped drawing. Keep this window in front and uncovered, then record again.';
const DUR_MIN = 1.5;
const DUR_MAX = 15;
const PREVIEW_SCALE = 0.5;
const COMPARE_SCALE = 0.28;

const recordingType = () => (window.MediaRecorder && HTMLCanvasElement.prototype.captureStream ? RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) : null);
const fileExt = (type) => (type.startsWith('video/mp4') ? 'mp4' : 'webm');
const megabytes = (n) => `${(n / 1048576).toFixed(1)} MB`;
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;
const langName = (id) => LANGS.find((l) => l.id === id).name;

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

const textFile = (text, type) => new Blob([text], { type: `${type};charset=utf-8` });

/** What the browser says about a finished recording. */
function inspectVideo(url) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const finish = () => resolve({ width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration * 1000 : null });
    video.onloadedmetadata = finish;
    video.onerror = () => resolve(null);
    setTimeout(() => resolve(null), 8000);
    video.src = url;
  });
}

export async function showMarketing(app, isCurrent) {
  let kit;
  try {
    kit = await loadKit(api);
  } catch (err) {
    if (isCurrent()) app.innerHTML = `<section class="screen" dir="ltr"><p class="sub">Couldn't open the Marketing Studio: ${esc(err.message)}</p></section>`;
    return () => {};
  }
  if (!isCurrent()) return () => {};

  const project = normalizeProject(kit.project);
  await prepareImages(project, kit);
  if (!isCurrent()) return () => {};

  const type = recordingType();
  const takes = [];
  let time = 0;
  let playing = false;
  let lang = 'en';
  let compare = false;
  let showSafe = false;
  let selected = timeline(project).scenes[0]?.id;
  let recording = null; // { cancelled, failure }
  let frame = 0;
  let lastNow = 0;
  let dirty = true;
  let saveTimer = 0;
  let unsaved = false;

  app.innerHTML = `
    <section class="mk" dir="ltr" lang="en">
      <header class="mk-top">
        <a class="mk-back" href="#/progress" aria-label="Back to Progress">←</a>
        <h1>Marketing Studio</h1>
        <span class="mk-save" data-save-state>All changes saved</span>
        <button class="btn btn-marigold mk-record" data-act="record-all" ${type ? '' : 'disabled'}>Record all 3 languages</button>
      </header>
      ${type ? '' : '<p class="mk-warn">This browser can\'t record video. Open the Studio in desktop Chrome or Edge.</p>'}
      <div class="mk-grid">
        <div class="mk-col">
          <div class="panel mk-panel"><h2>Video</h2><div data-templates></div></div>
          <div class="panel mk-panel"><h2>Size</h2><div data-formats></div></div>
          <div class="panel mk-panel"><h2>Timeline <small data-total></small></h2><ol class="mk-scenes" data-scenes></ol></div>
        </div>
        <div class="mk-stage">
          <div class="mk-view" data-view>
            <div class="mk-canvas-wrap" data-single><canvas data-preview></canvas><div class="mk-safe" data-safe hidden></div></div>
            <div class="mk-compare" data-compare hidden>
              ${LANGS.map((l) => `<figure><canvas data-compare-canvas="${l.id}"></canvas><figcaption>${l.name}</figcaption></figure>`).join('')}
            </div>
          </div>
          <div class="panel mk-transport">
            <div class="mk-track">
              <input type="range" min="0" step="10" data-seek aria-label="Position in the video">
              <div class="mk-ticks" data-ticks aria-hidden="true"></div>
            </div>
            <div class="mk-controls">
              <button class="btn btn-small btn-ghost-ink" data-act="toggle-play">Play</button>
              <span class="mk-time" data-time></span>
              <div class="seg mk-langs" role="group" aria-label="Language in the preview">
                ${LANGS.map((l) => `<button type="button" data-lang="${l.id}">${l.name}</button>`).join('')}
                <button type="button" data-lang="all">All 3</button>
              </div>
              <label class="mk-check"><input type="checkbox" data-safe-toggle> Safe zones</label>
              <button class="btn btn-small btn-ghost-ink" data-act="stills">Save stills</button>
            </div>
          </div>
        </div>
        <div class="mk-col">
          <div class="panel mk-panel"><h2>Words <small data-words-scene></small></h2><div data-words></div></div>
          <div class="panel mk-panel" data-questions-panel><h2>Questions</h2><div data-questions></div></div>
          <div class="panel mk-panel">
            <h2>Link on the end card</h2>
            <input class="mk-input" data-url dir="ltr" maxlength="60" placeholder="${esc(kit.siteUrl.replace(/^https?:\/\//, ''))}" value="${esc(project.url)}">
          </div>
        </div>
      </div>
      <div class="mk-lower">
        <div class="panel mk-panel">
          <h2>Recordings</h2>
          <p class="mk-note">Each language records in real time. Silent on purpose, so your editors can add sound.</p>
          <div data-takes></div>
          <video class="mk-player" data-player controls playsinline hidden></video>
        </div>
        <div class="panel mk-panel">
          <h2>For the video editor</h2>
          <p class="mk-note">All three languages share this timing, so one sound edit fits every version.</p>
          <div class="mk-buttons">
            <button class="btn btn-small btn-ghost-ink" data-act="sheet">Timing sheet (CSV)</button>
            ${LANGS.map((l) => `<button class="btn btn-small btn-ghost-ink" data-act="srt" data-srt="${l.id}">${l.name} subtitles</button>`).join('')}
          </div>
          <div class="mk-cues" data-cues></div>
        </div>
      </div>
      <div class="mk-recording" data-recording hidden role="dialog" aria-modal="true" aria-label="Recording">
        <div class="panel mk-recording-box">
          <canvas data-record-canvas></canvas>
          <div>
            <h2 data-rec-title>Recording</h2>
            <p>Keep this tab open and in front until it finishes. Leaving it stops the recording.</p>
            <div class="meter"><span data-rec-bar style="width:0"></span></div>
            <button class="btn btn-ghost-ink btn-block" data-act="cancel-record">Stop</button>
          </div>
        </div>
      </div>
    </section>`;

  const root = app.querySelector('.mk');
  const $ = (s) => root.querySelector(s);
  const measure = document.createElement('canvas').getContext('2d');
  const preview = $('[data-preview]');
  const previewCtx = preview.getContext('2d', { alpha: false });
  const compares = LANGS.map((l) => ({ id: l.id, canvas: $(`[data-compare-canvas="${l.id}"]`) })).map((c) => ({ ...c, ctx: c.canvas.getContext('2d', { alpha: false }) }));

  const tl = () => timeline(project);
  const templateBag = (name) => {
    project[name][project.template] ??= name === 'questions' ? [] : {};
    return project[name][project.template];
  };

  function markChanged() {
    unsaved = true;
    $('[data-save-state]').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY);
    dirty = true;
  }

  async function save() {
    if (!unsaved) return;
    unsaved = false;
    try {
      await api('/api/marketing/project', { method: 'PUT', body: project });
      if (!unsaved && isCurrent()) $('[data-save-state]').textContent = 'All changes saved';
    } catch (err) {
      unsaved = true;
      if (isCurrent()) $('[data-save-state]').textContent = `Not saved: ${err.message}`;
    }
  }

  // ── Panels ────────────────────────────────────────────────────

  function drawTemplates() {
    $('[data-templates]').innerHTML = Object.entries(TEMPLATES).map(([id, t]) => `
      <button type="button" class="mk-option" data-template="${id}" aria-pressed="${project.template === id}">
        <strong>${esc(t.name)}</strong><span>${esc(t.about)}</span>
      </button>`).join('');
  }

  function drawFormats() {
    $('[data-formats]').innerHTML = Object.entries(FORMATS).map(([id, f]) => `
      <button type="button" class="mk-option" data-format="${id}" aria-pressed="${project.format === id}">
        <strong>${esc(f.name)}</strong><span>${esc(f.use)} · ${f.w}×${f.h}</span>
      </button>`).join('');
  }

  function drawScenes() {
    const { scenes, total } = tl();
    const problems = fitProblems(measure, project, kit);
    const on = new Set(scenes.map((s) => s.id));
    $('[data-total]').textContent = seconds(total);
    $('[data-scenes]').innerHTML = TEMPLATES[project.template].scenes.map((s) => {
      const active = on.has(s.id);
      const live = scenes.find((x) => x.id === s.id);
      const warn = problems.some((x) => x.scene === s.id);
      return `
        <li class="${selected === s.id ? 'is-selected' : ''} ${active ? '' : 'is-off'}">
          <button type="button" class="mk-scene" data-scene="${s.id}"><span>${esc(s.label)}${warn ? ' <em title="Words need attention">!</em>' : ''}</span><small>${live ? clock(live.start) : 'Off'}</small></button>
          <input class="mk-dur" type="number" min="${DUR_MIN}" max="${DUR_MAX}" step="0.1" data-dur="${s.id}" value="${((live?.dur ?? project.durs[project.template]?.[s.id] ?? s.dur) / 1000).toFixed(1)}" aria-label="${esc(s.label)} length in seconds" ${active ? '' : 'disabled'}>
          <input type="checkbox" data-on="${s.id}" ${active ? 'checked' : ''} ${active && scenes.length === 1 ? 'disabled' : ''} aria-label="Include ${esc(s.label)}">
        </li>`;
    }).join('');
    $('[data-ticks]').innerHTML = scenes.map((s) => `<i style="left:${(s.start / total) * 100}%"></i>`).join('');
    const seek = $('[data-seek]');
    seek.max = String(Math.max(0, total - 1));
  }

  function drawWords() {
    const scene = TEMPLATES[project.template].scenes.find((s) => s.id === selected);
    if (!scene) return;
    $('[data-words-scene]').textContent = scene.label;
    const problems = fitProblems(measure, project, kit).filter((x) => x.scene === scene.id);
    $('[data-words]').innerHTML = `
      ${LANGS.map((l) => {
        const problem = problems.find((x) => x.lang === l.id);
        return `
          <label class="mk-field">
            <span>${l.name}${problem ? ` <em>${problem.why === 'empty' ? 'Empty' : 'Too long to fit'}</em>` : ''}</span>
            <textarea class="mk-input" rows="2" maxlength="120" dir="${l.dir}" lang="${l.id}" data-copy="${l.id}">${esc(sceneText(project, kit, scene, l.id, { raw: true }))}</textarea>
          </label>`;
      }).join('')}
      <p class="mk-note">{questions}, {topics} and {skins} fill in the live numbers.</p>
      <button type="button" class="link-btn mk-reset" data-act="reset-words">Reset these words</button>`;
  }

  function refreshWarnings() {
    const scene = TEMPLATES[project.template].scenes.find((s) => s.id === selected);
    const problems = fitProblems(measure, project, kit).filter((x) => x.scene === scene?.id);
    root.querySelectorAll('[data-copy]').forEach((box) => {
      const span = box.previousElementSibling;
      const problem = problems.find((x) => x.lang === box.dataset.copy);
      span.innerHTML = `${langName(box.dataset.copy)}${problem ? ` <em>${problem.why === 'empty' ? 'Empty' : 'Too long to fit'}</em>` : ''}`;
    });
    drawScenes();
  }

  function drawQuestions() {
    const count = TEMPLATES[project.template].questions;
    $('[data-questions-panel]').hidden = !count;
    if (!count) return;
    const chosen = videoQuestions(project, kit);
    const byTopic = new Map();
    for (const q of kit.usable) {
      if (!byTopic.has(q.cat)) byTopic.set(q.cat, []);
      byTopic.get(q.cat).push(q);
    }
    const options = [...byTopic].map(([cat, list]) => `<optgroup label="${esc(CATEGORY_BY_ID[cat]?.name ?? cat)}">${list.map((q) => `<option value="${esc(q.id)}">${esc(q.answer)} (difficulty ${q.difficulty ?? '?'})</option>`).join('')}</optgroup>`).join('');
    $('[data-questions]').innerHTML = `
      ${Array.from({ length: count }, (_, slot) => `
        <label class="mk-field"><span>Question ${slot + 1}</span><select class="mk-input" data-question="${slot}">${options}</select></label>`).join('')}
      <p class="mk-note">${kit.usable.length} questions have a local picture and full Hebrew and Arabic text.</p>`;
    root.querySelectorAll('[data-question]').forEach((select) => { select.value = chosen[Number(select.dataset.question)]?.id ?? ''; });
  }

  function drawCues() {
    $('[data-cues]').innerHTML = `<table><thead><tr><th>Time</th><th>Scene</th><th>Sound idea</th></tr></thead><tbody>
      ${soundCues(project).map((c) => `<tr><td>${clock(c.ms)}</td><td>${esc(c.scene)}</td><td>${esc(c.what)}</td></tr>`).join('')}
    </tbody></table>`;
  }

  function drawTakes() {
    const box = $('[data-takes]');
    if (!takes.length) {
      box.innerHTML = '<p class="mk-note">Nothing recorded yet in this visit.</p>';
      return;
    }
    box.innerHTML = `
      <table><thead><tr><th>Version</th><th>Length</th><th>Size</th><th>Check</th><th></th></tr></thead><tbody>
        ${takes.map((t, i) => `
          <tr>
            <td>${esc(langName(t.lang))}<br><small>${esc(TEMPLATES[t.template].name)}, ${esc(FORMATS[t.format].name)}</small></td>
            <td>${seconds(t.ms)}</td>
            <td>${megabytes(t.blob.size)}</td>
            <td class="${t.problem ? 'mk-bad' : 'mk-good'}">${esc(t.problem || 'Good')}</td>
            <td class="mk-row-buttons"><button class="link-btn" data-act="watch" data-take="${i}">Watch</button><button class="link-btn" data-act="save-take" data-take="${i}">Download</button></td>
          </tr>`).join('')}
      </tbody></table>
      <button class="btn btn-small btn-marigold" data-act="save-all">Download all</button>`;
  }

  function sizeCanvases() {
    const { w, h } = FORMATS[project.format];
    preview.width = w * PREVIEW_SCALE;
    preview.height = h * PREVIEW_SCALE;
    preview.style.aspectRatio = `${w} / ${h}`;
    for (const c of compares) {
      c.canvas.width = w * COMPARE_SCALE;
      c.canvas.height = h * COMPARE_SCALE;
    }
    $('[data-view]').dataset.shape = project.format;
    const safe = $('[data-safe]');
    safe.hidden = !showSafe || compare || project.format !== 'story';
    safe.style.cssText = `top:${(SAFE_ZONE.top / h) * 100}%;bottom:${(SAFE_ZONE.bottom / h) * 100}%;left:${(SAFE_ZONE.side / w) * 100}%;right:${(SAFE_ZONE.side / w) * 100}%`;
  }

  function drawLangButtons() {
    root.querySelectorAll('[data-lang]').forEach((b) => {
      const on = compare ? b.dataset.lang === 'all' : b.dataset.lang === lang;
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-selected', String(on)); // the shared .seg style follows this
    });
    $('[data-single]').hidden = compare;
    $('[data-compare]').hidden = !compare;
  }

  function drawEverything() {
    drawTemplates();
    drawFormats();
    drawScenes();
    drawWords();
    drawQuestions();
    drawCues();
    drawTakes();
    sizeCanvases();
    drawLangButtons();
    dirty = true;
  }

  function selectScene(id, { jump = true } = {}) {
    selected = id;
    const scene = tl().scenes.find((s) => s.id === id);
    if (jump && scene) {
      time = scene.start + Math.min(scene.dur * 0.6, 1400);
      playing = false;
      syncPlay();
    }
    drawScenes();
    drawWords();
    dirty = true;
  }

  function syncPlay() {
    $('[data-act="toggle-play"]').textContent = playing ? 'Pause' : 'Play';
  }

  // ── Preview ───────────────────────────────────────────────────

  function paint() {
    const { total } = tl();
    time = Math.min(time, Math.max(0, total - 1));
    if (compare) for (const c of compares) drawFrame(c.ctx, project, kit, c.id, time, COMPARE_SCALE);
    else drawFrame(previewCtx, project, kit, lang, time, PREVIEW_SCALE);
    $('[data-seek]').value = String(Math.round(time));
    $('[data-time]').textContent = `${clock(time)} / ${clock(total)}`;
  }

  function tick(now) {
    frame = requestAnimationFrame(tick);
    const delta = now - lastNow;
    lastNow = now;
    if (recording) return;
    if (playing) {
      const { total } = tl();
      time = total ? (time + delta) % total : 0;
      dirty = true;
      const current = tl().scenes.findLast((s) => s.start <= time);
      if (current && current.id !== selected) {
        selected = current.id;
        drawScenes();
        drawWords();
      }
    }
    if (dirty) {
      dirty = false;
      paint();
    }
  }

  // ── Recording ─────────────────────────────────────────────────

  async function recordTake(target, position, count) {
    const { w, h } = FORMATS[project.format];
    const { total } = tl();
    const canvas = $('[data-record-canvas]');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    $('[data-rec-title]').textContent = `Recording ${langName(target)} (${position} of ${count})`;
    const bar = $('[data-rec-bar]');
    bar.style.width = '0';
    drawFrame(ctx, project, kit, target, 0);

    const stream = canvas.captureStream(FPS);
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: BITRATE });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start(1000);
    const started = performance.now();
    let lastFrame = started;
    let longestGap = 0;
    await new Promise((resolve) => {
      // A window that stops being drawn (covered, minimised) stops these frames without any event.
      const watchdog = setInterval(() => {
        if (performance.now() - lastFrame > STALL_MS) recording.failure = STALLED;
        if (recording.failure) done();
      }, 250);
      function done() {
        clearInterval(watchdog);
        resolve();
      }
      const step = (now) => {
        if (recording.cancelled || recording.failure) return done();
        longestGap = Math.max(longestGap, now - lastFrame);
        lastFrame = now;
        const at = now - started;
        drawFrame(ctx, project, kit, target, at);
        bar.style.width = `${clamp01(at / total) * 100}%`;
        if (at >= total) return done();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const measured = performance.now() - started;
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    if (recording.cancelled || recording.failure) return null;

    const blob = new Blob(chunks, { type: type.split(';')[0] });
    const url = URL.createObjectURL(blob);
    const info = await inspectVideo(url);
    const ms = info?.duration ?? measured;
    let problem = '';
    if (!blob.size) problem = 'Empty recording';
    else if (!info) problem = 'This browser couldn\'t read it back';
    else if (info.width !== w || info.height !== h) problem = `Wrong size: ${info.width}×${info.height}`;
    else if (Math.abs(ms - total) > LENGTH_TOLERANCE_MS) problem = `Length is off by ${seconds(Math.abs(ms - total))}`;
    else if (longestGap > STUTTER_MS) problem = 'Stuttered while recording. Close other apps and record again.';
    return { lang: target, template: project.template, format: project.format, blob, url, ms, problem, type };
  }

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  const leftTab = () => {
    if (recording && document.hidden) recording.failure = 'The recording stopped because this tab went to the background. Keep it in front and record again.';
  };

  async function recordAll() {
    if (recording || !type) return;
    playing = false;
    syncPlay();
    await save();
    await prepareImages(project, kit);
    recording = { cancelled: false, failure: '' };
    $('[data-recording]').hidden = false;
    const order = [...LANGS.map((l) => l.id)];
    for (let i = 0; i < order.length && !recording.cancelled && !recording.failure; i++) {
      const take = await recordTake(order[i], i + 1, order.length);
      if (!take) break;
      const old = takes.findIndex((t) => t.lang === take.lang && t.template === take.template && t.format === take.format);
      if (old >= 0) {
        URL.revokeObjectURL(takes[old].url);
        takes.splice(old, 1, take);
      } else takes.push(take);
    }
    const failure = recording.failure;
    recording = null;
    $('[data-recording]').hidden = true;
    drawTakes();
    dirty = true;
    if (failure) window.alert(failure);
  }

  const takeName = (t) => `smarts-${t.template}-${t.format}-${t.lang}.${fileExt(t.type)}`;
  const baseName = () => `smarts-${project.template}-${project.format}`;

  async function saveStills() {
    const { w, h } = FORMATS[project.format];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    for (const l of LANGS) {
      drawFrame(ctx, project, kit, l.id, time);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      download(blob, `${baseName()}-${l.id}-${Math.round(time)}ms.png`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  // ── Events ────────────────────────────────────────────────────

  const actions = {
    'toggle-play': () => {
      playing = !playing;
      syncPlay();
    },
    'record-all': recordAll,
    'cancel-record': () => { if (recording) recording.cancelled = true; },
    stills: saveStills,
    sheet: () => download(textFile(editSheetCsv(project, kit), 'text/csv'), `${baseName()}-timing.csv`),
    srt: (b) => download(textFile(subtitlesSrt(project, kit, b.dataset.srt), 'application/x-subrip'), `${baseName()}-${b.dataset.srt}.srt`),
    'reset-words': () => {
      delete templateBag('copy')[selected];
      markChanged();
      drawWords();
      drawScenes();
    },
    watch: (b) => {
      const player = $('[data-player]');
      player.hidden = false;
      player.src = takes[Number(b.dataset.take)].url;
      player.play().catch(() => {});
    },
    'save-take': (b) => {
      const t = takes[Number(b.dataset.take)];
      download(t.blob, takeName(t));
    },
    'save-all': async () => {
      for (const t of takes) {
        download(t.blob, takeName(t));
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    },
  };

  root.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-act]');
    if (action) return actions[action.dataset.act]?.(action);
    const template = e.target.closest('[data-template]');
    if (template) {
      project.template = template.dataset.template;
      selected = tl().scenes[0]?.id;
      time = 0;
      playing = false;
      syncPlay();
      markChanged();
      await prepareImages(project, kit);
      drawEverything();
      return undefined;
    }
    const format = e.target.closest('[data-format]');
    if (format) {
      project.format = format.dataset.format;
      markChanged();
      drawEverything();
      return undefined;
    }
    const scene = e.target.closest('[data-scene]');
    if (scene) return selectScene(scene.dataset.scene);
    const pick = e.target.closest('[data-lang]');
    if (pick) {
      compare = pick.dataset.lang === 'all';
      if (!compare) lang = pick.dataset.lang;
      sizeCanvases();
      drawLangButtons();
      dirty = true;
    }
    return undefined;
  });

  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('[data-seek]')) {
      time = Number(el.value);
      playing = false;
      syncPlay();
      dirty = true;
    } else if (el.matches('[data-copy]')) {
      const bag = templateBag('copy');
      bag[selected] ??= {};
      bag[selected][el.dataset.copy] = el.value;
      markChanged();
      refreshWarnings();
    } else if (el.matches('[data-url]')) {
      project.url = el.value.trim();
      markChanged();
    }
  });

  root.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.matches('[data-dur]')) {
      const value = Math.min(DUR_MAX, Math.max(DUR_MIN, Number(el.value) || DUR_MIN));
      templateBag('durs')[el.dataset.dur] = Math.round(value * 1000);
      markChanged();
      drawScenes();
      drawCues();
    } else if (el.matches('[data-on]')) {
      const off = templateBag('off');
      if (el.checked) delete off[el.dataset.on];
      else off[el.dataset.on] = true;
      if (!tl().scenes.some((s) => s.id === selected)) selected = tl().scenes[0]?.id;
      markChanged();
      drawScenes();
      drawWords();
      drawCues();
    } else if (el.matches('[data-question]')) {
      const list = videoQuestions(project, kit).map((q) => q.id);
      const slot = Number(el.dataset.question);
      const other = list.indexOf(el.value);
      if (other >= 0 && other !== slot) list[other] = list[slot]; // choosing one already used swaps them
      list[slot] = el.value;
      project.questions[project.template] = list;
      markChanged();
      await prepareImages(project, kit);
      drawQuestions();
      dirty = true;
    } else if (el.matches('[data-safe-toggle]')) {
      showSafe = el.checked;
      sizeCanvases();
    }
  });

  document.addEventListener('visibilitychange', leftTab);
  const warnLeaving = (e) => {
    if (recording || unsaved) e.preventDefault();
  };
  window.addEventListener('beforeunload', warnLeaving);

  drawEverything();
  syncPlay();
  $('[data-url]').placeholder = shownUrl({ ...project, url: '' }, kit);
  lastNow = performance.now();
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(saveTimer);
    save();
    if (recording) recording.cancelled = true;
    document.removeEventListener('visibilitychange', leftTab);
    window.removeEventListener('beforeunload', warnLeaving);
    for (const t of takes) URL.revokeObjectURL(t.url);
  };
}
