// The Marketing Studio: edit one video, preview it in Arabic, English and Hebrew, and record all
// three with the same timing. The videos have no sound; the editors add it, once, using the timing
// sheet. Only the people in MARKETING_USERS reach this screen, and the server checks it too.
// It's an internal tool, so its own labels are in English; the videos are what get translated.
//
// Besides the built-in videos, the team can put their own together from scene blocks (SCENE_KINDS
// in studio.js): add, remove and reorder scenes, start from scratch or from a copy of a built-in.

import { api, esc } from './util.js';
import { CATEGORY_BY_ID } from '/shared/config.js';
import {
  FORMATS, LANGS, SAFE_ZONE, SCENE_KINDS, TEMPLATES, THEMES, clock, drawFrame, editSheetCsv, fitProblems, loadKit, normalizeProject,
  prepareImages, sceneText, shownUrl, soundCues, subtitlesSrt, timeline, videoOf, videoQuestions,
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
const MAX_SCENES = 20;
const HASHTAGS = { en: '#Smarts #quiz #trivia', he: '#Smarts #טריוויה #חידון', ar: '#Smarts #مسابقة #ثقافة_عامة' };

const recordingType = () => (window.MediaRecorder && HTMLCanvasElement.prototype.captureStream ? RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) : null);
const fileExt = (type) => (type.startsWith('video/mp4') ? 'mp4' : 'webm');
const megabytes = (n) => `${(n / 1048576).toFixed(1)} MB`;
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;
const langName = (id) => LANGS.find((l) => l.id === id).name;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
const toPng = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

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
  const recordLangs = new Set(LANGS.map((l) => l.id));
  const recordFormats = new Set([project.format]);

  app.innerHTML = `
    <section class="mk" dir="ltr" lang="en">
      <header class="mk-top">
        <a class="mk-back" href="#/progress" aria-label="Back to Progress">←</a>
        <h1>Marketing Studio</h1>
        <span class="mk-save" data-save-state>All changes saved</span>
        <button class="btn btn-marigold mk-record" data-act="record-all" ${type ? '' : 'disabled'}>Record</button>
      </header>
      ${type ? '' : '<p class="mk-warn">This browser can\'t record video. Open the Studio in desktop Chrome or Edge.</p>'}
      <div class="mk-grid">
        <div class="mk-col">
          <div class="panel mk-panel"><h2>Video</h2><div data-templates></div></div>
          <div class="panel mk-panel"><h2>Look</h2><div class="mk-swatches" data-themes></div></div>
          <div class="panel mk-panel"><h2>Size</h2><div data-formats></div></div>
          <div class="panel mk-panel">
            <h2>Timeline <small data-total></small></h2>
            <ol class="mk-scenes" data-scenes></ol>
            <div class="mk-add" data-add hidden>
              <select class="mk-input" data-add-kind aria-label="Kind of scene to add">
                ${Object.entries(SCENE_KINDS).map(([id, k]) => `<option value="${id}">${esc(k.label)} — ${esc(k.about)}</option>`).join('')}
              </select>
              <button class="btn btn-small btn-ghost-ink" data-act="add-scene">Add scene</button>
            </div>
          </div>
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
            <p class="mk-note mk-keys">Space plays and pauses. ← → step a frame (with Shift, a second). Home and End jump to the ends.</p>
          </div>
        </div>
        <div class="mk-col">
          <div class="panel mk-panel"><h2>Words <small data-words-scene></small></h2><div data-words></div></div>
          <div class="panel mk-panel" data-questions-panel><h2>Questions</h2><div data-questions></div></div>
          <div class="panel mk-panel">
            <h2>Link on the end card</h2>
            <input class="mk-input" data-url dir="ltr" maxlength="60" placeholder="${esc(kit.siteUrl.replace(/^https?:\/\//, ''))}" value="${esc(project.url)}">
          </div>
          <div class="panel mk-panel">
            <h2>Post text</h2>
            <p class="mk-note">The caption to post with this video. Empty boxes show a suggestion made from its words.</p>
            <div data-posts></div>
          </div>
        </div>
      </div>
      <div class="mk-lower">
        <div class="panel mk-panel">
          <h2>Recordings</h2>
          <p class="mk-note">Each video records in real time. Silent on purpose, so your editors can add sound.</p>
          <div class="mk-pick">
            <div class="mk-pick-group" role="group" aria-label="Languages to record">
              <span>Languages</span>
              ${LANGS.map((l) => `<label class="mk-check"><input type="checkbox" data-rec-lang="${l.id}" checked> ${l.name}</label>`).join('')}
            </div>
            <div class="mk-pick-group" role="group" aria-label="Sizes to record">
              <span>Sizes</span>
              ${Object.entries(FORMATS).map(([id, f]) => `<label class="mk-check"><input type="checkbox" data-rec-format="${id}"> ${esc(f.name)}</label>`).join('')}
            </div>
          </div>
          <div data-takes></div>
          <video class="mk-player" data-player controls playsinline hidden></video>
        </div>
        <div class="panel mk-panel">
          <h2>For the video editor</h2>
          <p class="mk-note">All three languages share this timing, so one sound edit fits every version.</p>
          <div class="mk-buttons">
            <button class="btn btn-small btn-ghost-ink" data-act="sheet">Timing sheet (CSV)</button>
            ${LANGS.map((l) => `<button class="btn btn-small btn-ghost-ink" data-act="srt" data-srt="${l.id}">${l.name} subtitles</button>`).join('')}
            <button class="btn btn-small btn-ghost-ink" data-act="storyboard">Storyboard (PNG)</button>
          </div>
          <div class="mk-cues" data-cues></div>
          <h2 class="mk-h2-gap">Project backup</h2>
          <p class="mk-note">Everything in the Studio, as one file: videos, words, timing and post text. Load it here or on another server.</p>
          <div class="mk-buttons">
            <button class="btn btn-small btn-ghost-ink" data-act="export-project">Download project</button>
            <button class="btn btn-small btn-ghost-ink" data-act="import-project">Load project…</button>
            <input type="file" accept="application/json,.json" data-import hidden>
          </div>
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
  const video = () => videoOf(project);
  const isCustom = () => !!project.custom[project.template];
  const own = () => project.custom[project.template];
  const bag = (name) => {
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

  // ── Your own videos ───────────────────────────────────────────

  const freeId = (prefix, taken) => {
    let n = 1;
    while (taken(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  };
  const newSceneId = (scenes) => freeId('s', (id) => scenes.some((s) => s.id === id));

  /** Moves everything stored under one scene (words, length, off) to another id, in another video if asked. */
  function copySceneData(fromVideo, fromScene, toVideo, toScene) {
    for (const name of ['copy', 'durs', 'off']) {
      const value = project[name][fromVideo]?.[fromScene];
      if (value === undefined) continue;
      project[name][toVideo] ??= {};
      project[name][toVideo][toScene] = typeof value === 'object' ? { ...value } : value;
    }
  }

  /** A new video of the team's own: blank, or a copy of `from` they can take apart. */
  function createVideo(from) {
    const id = freeId('c', (x) => project.custom[x]);
    const source = from ? videoOf(project, from) : null;
    const name = source ? `${source.name} (copy)` : `Video ${Object.keys(project.custom).length + 1}`;
    project.custom[id] = { name, scenes: source ? source.scenes.map((s) => ({ id: s.id, kind: s.kind, label: s.label })) : [] };
    if (source) {
      for (const s of source.scenes) {
        copySceneData(from, s.id, id, s.id);
        // The built-in words become this video's own, so they stay even if the built-in changes.
        project.copy[id] ??= {};
        project.copy[id][s.id] = Object.fromEntries(LANGS.map((l) => [l.id, sceneText({ ...project, template: from }, kit, s, l.id, { raw: true })]));
      }
      if (project.questions[from]) project.questions[id] = [...project.questions[from]];
      if (project.look[from]) project.look[id] = project.look[from];
      if (project.posts[from]) project.posts[id] = { ...project.posts[from] };
    }
    return id;
  }

  function deleteVideo(id) {
    delete project.custom[id];
    for (const name of ['copy', 'off', 'durs', 'questions', 'look', 'posts']) delete project[name][id];
    if (project.template === id) project.template = 'promo';
  }

  function addScene(kind) {
    const v = own();
    if (!v || v.scenes.length >= MAX_SCENES) return;
    const at = v.scenes.findIndex((s) => s.id === selected);
    const scene = { id: newSceneId(v.scenes), kind };
    v.scenes.splice(at >= 0 ? at + 1 : v.scenes.length, 0, scene);
    selected = scene.id;
  }

  function duplicateScene(id) {
    const v = own();
    const at = v?.scenes.findIndex((s) => s.id === id) ?? -1;
    if (at < 0 || v.scenes.length >= MAX_SCENES) return;
    const scene = { ...v.scenes[at], id: newSceneId(v.scenes) };
    v.scenes.splice(at + 1, 0, scene);
    copySceneData(project.template, id, project.template, scene.id);
    selected = scene.id;
  }

  function removeScene(id) {
    const v = own();
    const at = v?.scenes.findIndex((s) => s.id === id) ?? -1;
    if (at < 0) return;
    v.scenes.splice(at, 1);
    for (const name of ['copy', 'durs', 'off']) delete project[name][project.template]?.[id];
    if (selected === id) selected = (v.scenes[at] ?? v.scenes[at - 1])?.id;
  }

  function moveScene(id, by) {
    const v = own();
    const at = v?.scenes.findIndex((s) => s.id === id) ?? -1;
    const to = at + by;
    if (at < 0 || to < 0 || to >= v.scenes.length) return;
    [v.scenes[at], v.scenes[to]] = [v.scenes[to], v.scenes[at]];
  }

  /** After the scenes change: the selection may be gone, the questions may have moved slots. */
  async function scenesChanged() {
    if (!tl().scenes.some((s) => s.id === selected)) selected = tl().scenes[0]?.id;
    markChanged();
    await prepareImages(project, kit);
    drawEverything();
  }

  // ── Panels ────────────────────────────────────────────────────

  function drawTemplates() {
    const customs = Object.entries(project.custom);
    const current = video();
    $('[data-templates]').innerHTML = `
      ${Object.entries(TEMPLATES).map(([id, t]) => `
        <button type="button" class="mk-option" data-template="${id}" aria-pressed="${project.template === id}">
          <strong>${esc(t.name)}</strong><span>${esc(t.about)}</span>
        </button>`).join('')}
      <h3 class="mk-h3">Your videos</h3>
      ${customs.length ? customs.map(([id, c]) => `
        <button type="button" class="mk-option" data-template="${id}" aria-pressed="${project.template === id}">
          <strong>${esc(c.name)}</strong><span>${esc(videoOf(project, id).about)}</span>
        </button>`).join('') : '<p class="mk-note">None yet. Start blank, or copy the video above and change it.</p>'}
      <div class="mk-buttons">
        <button type="button" class="btn btn-small btn-ghost-ink" data-act="new-video">New blank video</button>
        <button type="button" class="btn btn-small btn-ghost-ink" data-act="copy-video" title="Make a copy of ${esc(current.name)} that you can change">Copy “${esc(current.name)}”</button>
      </div>
      ${isCustom() ? `
        <label class="mk-field mk-field-gap"><span>Name</span><input class="mk-input" data-video-name maxlength="60" value="${esc(own().name)}"></label>
        <button type="button" class="link-btn mk-reset" data-act="delete-video">Delete this video</button>` : ''}`;
  }

  function drawThemes() {
    const on = project.look[project.template] ?? 'cobalt';
    $('[data-themes]').innerHTML = Object.entries(THEMES).map(([id, t]) => `
      <button type="button" class="mk-swatch" data-theme="${id}" aria-pressed="${on === id}" title="${esc(t.name)}" style="--a:${t.glow};--b:${t.deep};--c:${t.accent}">
        <i></i><span>${esc(t.name)}</span>
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
    const all = video().scenes;
    const custom = isCustom();
    const problems = fitProblems(measure, project, kit);
    const on = new Set(scenes.map((s) => s.id));
    $('[data-total]').textContent = seconds(total);
    $('[data-add]').hidden = !custom;
    $('[data-act="add-scene"]').disabled = all.length >= MAX_SCENES;
    $('[data-scenes]').innerHTML = all.length ? all.map((s, i) => {
      const active = on.has(s.id);
      const live = scenes.find((x) => x.id === s.id);
      const warn = problems.some((x) => x.scene === s.id);
      const tools = custom && selected === s.id ? `
        <div class="mk-scene-tools">
          <button type="button" class="link-btn" data-act="scene-up" ${i === 0 ? 'disabled' : ''}>↑ Up</button>
          <button type="button" class="link-btn" data-act="scene-down" ${i === all.length - 1 ? 'disabled' : ''}>↓ Down</button>
          <button type="button" class="link-btn" data-act="scene-dup" ${all.length >= MAX_SCENES ? 'disabled' : ''}>Duplicate</button>
          <button type="button" class="link-btn mk-danger" data-act="scene-remove">Remove</button>
        </div>` : '';
      return `
        <li class="${selected === s.id ? 'is-selected' : ''} ${active ? '' : 'is-off'}">
          <button type="button" class="mk-scene" data-scene="${s.id}"><span>${esc(s.label)}${warn ? ' <em title="Words need attention">!</em>' : ''}</span><small>${live ? clock(live.start) : 'Off'}</small></button>
          <input class="mk-dur" type="number" min="${DUR_MIN}" max="${DUR_MAX}" step="0.1" data-dur="${s.id}" value="${((live?.dur ?? project.durs[project.template]?.[s.id] ?? s.dur) / 1000).toFixed(1)}" aria-label="${esc(s.label)} length in seconds" ${active ? '' : 'disabled'}>
          <input type="checkbox" data-on="${s.id}" ${active ? 'checked' : ''} ${active && scenes.length === 1 ? 'disabled' : ''} aria-label="Include ${esc(s.label)}">
          ${tools}
        </li>`;
    }).join('') : '<li class="mk-empty">No scenes yet. Add one below.</li>';
    $('[data-ticks]').innerHTML = scenes.map((s) => `<i style="left:${(s.start / total) * 100}%"></i>`).join('');
    $('[data-seek]').max = String(Math.max(0, total - 1));
  }

  function drawWords() {
    const scene = video().scenes.find((s) => s.id === selected);
    if (!scene) {
      $('[data-words-scene]').textContent = '';
      $('[data-words]').innerHTML = '<p class="mk-note">Add a scene to write its words.</p>';
      return;
    }
    $('[data-words-scene]').textContent = scene.label;
    const problems = fitProblems(measure, project, kit).filter((x) => x.scene === scene.id);
    $('[data-words]').innerHTML = `
      ${isCustom() ? `<label class="mk-field"><span>Scene name <small>(for you and the editor)</small></span><input class="mk-input" data-scene-label maxlength="40" value="${esc(scene.label)}"></label>` : ''}
      ${LANGS.map((l) => {
        const problem = problems.find((x) => x.lang === l.id);
        return `
          <label class="mk-field">
            <span>${l.name}${problem ? ` <em>${problem.why === 'empty' ? 'Empty' : 'Too long to fit'}</em>` : ''}</span>
            <textarea class="mk-input" rows="2" maxlength="120" dir="${l.dir}" lang="${l.id}" data-copy="${l.id}">${esc(sceneText(project, kit, scene, l.id, { raw: true }))}</textarea>
          </label>`;
      }).join('')}
      <p class="mk-note">{questions}, {topics}, {skins} and {players} fill in the live numbers.</p>
      <button type="button" class="link-btn mk-reset" data-act="reset-words">Reset these words</button>`;
  }

  function refreshWarnings() {
    const scene = video().scenes.find((s) => s.id === selected);
    const problems = fitProblems(measure, project, kit).filter((x) => x.scene === scene?.id);
    root.querySelectorAll('[data-copy]').forEach((box) => {
      const span = box.previousElementSibling;
      const problem = problems.find((x) => x.lang === box.dataset.copy);
      span.innerHTML = `${langName(box.dataset.copy)}${problem ? ` <em>${problem.why === 'empty' ? 'Empty' : 'Too long to fit'}</em>` : ''}`;
    });
    drawScenes();
  }

  function drawQuestions() {
    const slots = video().scenes.filter((s) => s.slot !== undefined);
    $('[data-questions-panel]').hidden = !slots.length;
    if (!slots.length) return;
    const chosen = videoQuestions(project, kit);
    const byTopic = new Map();
    for (const q of kit.usable) {
      if (!byTopic.has(q.cat)) byTopic.set(q.cat, []);
      byTopic.get(q.cat).push(q);
    }
    const options = [...byTopic].map(([cat, list]) => `<optgroup label="${esc(CATEGORY_BY_ID[cat]?.name ?? cat)}">${list.map((q) => `<option value="${esc(q.id)}">${esc(q.answer)} (difficulty ${q.difficulty ?? '?'})</option>`).join('')}</optgroup>`).join('');
    $('[data-questions]').innerHTML = `
      ${slots.map((s) => `
        <label class="mk-field"><span>${esc(s.label)}</span><select class="mk-input" data-question="${s.slot}">${options}</select></label>`).join('')}
      <p class="mk-note">${kit.usable.length} questions have a local picture and full Hebrew and Arabic text.</p>`;
    root.querySelectorAll('[data-question]').forEach((select) => { select.value = chosen[Number(select.dataset.question)]?.id ?? ''; });
  }

  /** A caption for the post, made from the video's first and last words and the link. */
  function suggestedPost(id) {
    const { scenes } = tl();
    const lines = [];
    if (scenes[0]) lines.push(sceneText(project, kit, scenes[0], id));
    const cta = scenes.findLast((s) => s.kind === 'cta');
    if (cta && cta !== scenes[0]) lines.push(sceneText(project, kit, cta, id));
    lines.push(`https://${shownUrl(project, kit)}`, '', HASHTAGS[id]);
    return lines.join('\n');
  }

  const postText = (id) => project.posts[project.template]?.[id] || suggestedPost(id);

  function drawPosts() {
    const saved = project.posts[project.template] ?? {};
    $('[data-posts]').innerHTML = LANGS.map((l) => `
      <label class="mk-field">
        <span>${l.name} <button type="button" class="link-btn mk-copy" data-act="copy-post" data-post="${l.id}">Copy</button></span>
        <textarea class="mk-input" rows="4" maxlength="2200" dir="${l.dir}" lang="${l.id}" data-post-text="${l.id}" placeholder="${esc(suggestedPost(l.id))}">${esc(saved[l.id] ?? '')}</textarea>
      </label>`).join('');
  }

  function drawCues() {
    $('[data-cues]').innerHTML = `<table><thead><tr><th>Time</th><th>Scene</th><th>Sound idea</th></tr></thead><tbody>
      ${soundCues(project).map((c) => `<tr><td>${clock(c.ms)}</td><td>${esc(c.scene)}</td><td>${esc(c.what)}</td></tr>`).join('')}
    </tbody></table>`;
  }

  const recordJobs = () => Object.keys(FORMATS).filter((f) => recordFormats.has(f)).flatMap((format) => LANGS.filter((l) => recordLangs.has(l.id)).map((l) => ({ lang: l.id, format })));

  function drawRecordButton() {
    const n = recordJobs().length;
    const button = $('[data-act="record-all"]');
    button.textContent = n ? `Record ${n} ${n === 1 ? 'video' : 'videos'}` : 'Record';
    button.disabled = !type || !n || !tl().scenes.length;
    root.querySelectorAll('[data-rec-lang]').forEach((box) => { box.checked = recordLangs.has(box.dataset.recLang); });
    root.querySelectorAll('[data-rec-format]').forEach((box) => { box.checked = recordFormats.has(box.dataset.recFormat); });
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
            <td>${esc(langName(t.lang))}<br><small>${esc(t.name)}, ${esc(FORMATS[t.format].name)}</small></td>
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
    drawThemes();
    drawFormats();
    drawScenes();
    drawWords();
    drawQuestions();
    drawPosts();
    drawCues();
    drawRecordButton();
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

  function seekTo(ms) {
    const { total } = tl();
    time = Math.min(Math.max(0, ms), Math.max(0, total - 1));
    playing = false;
    syncPlay();
    dirty = true;
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

  async function recordTake(job, position, count) {
    const p = { ...project, format: job.format };
    const { w, h } = FORMATS[job.format];
    const { total } = tl();
    const canvas = $('[data-record-canvas]');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    $('[data-rec-title]').textContent = `Recording ${langName(job.lang)}, ${FORMATS[job.format].name} (${position} of ${count})`;
    const bar = $('[data-rec-bar]');
    bar.style.width = '0';
    drawFrame(ctx, p, kit, job.lang, 0);

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
        drawFrame(ctx, p, kit, job.lang, at);
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
    return { lang: job.lang, template: project.template, name: video().name, format: job.format, blob, url, ms, problem, type };
  }

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  const leftTab = () => {
    if (recording && document.hidden) recording.failure = 'The recording stopped because this tab went to the background. Keep it in front and record again.';
  };

  async function recordAll() {
    const jobs = recordJobs();
    if (recording || !type || !jobs.length || !tl().scenes.length) return;
    playing = false;
    syncPlay();
    await save();
    await prepareImages(project, kit);
    recording = { cancelled: false, failure: '' };
    $('[data-recording]').hidden = false;
    for (let i = 0; i < jobs.length && !recording.cancelled && !recording.failure; i++) {
      const take = await recordTake(jobs[i], i + 1, jobs.length);
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
      download(await toPng(canvas), `${baseName()}-${l.id}-${Math.round(time)}ms.png`);
      await delay(300);
    }
  }

  /** One sheet per language with a frame from every scene, for briefing the editor. */
  async function saveStoryboard() {
    const { w, h } = FORMATS[project.format];
    const { scenes } = tl();
    if (!scenes.length) return;
    const cols = project.format === 'wide' ? 2 : project.format === 'square' ? 3 : 4;
    const tw = project.format === 'wide' ? 640 : 300;
    const th = Math.round((tw * h) / w);
    const pad = 28;
    const caption = 46;
    const head = 80;
    const rows = Math.ceil(scenes.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = pad + cols * (tw + pad);
    sheet.height = head + rows * (th + caption + pad);
    const ctx = sheet.getContext('2d', { alpha: false });
    const thumb = document.createElement('canvas');
    thumb.width = tw;
    thumb.height = th;
    const tctx = thumb.getContext('2d', { alpha: false });
    for (const l of LANGS) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.direction = 'ltr';
      ctx.fillStyle = '#fbfbf8';
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.fillStyle = '#141833';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '800 26px "Schibsted Grotesk", system-ui, sans-serif';
      ctx.fillText(`${video().name} · ${FORMATS[project.format].name} · ${l.name} · ${seconds(tl().total)}`, pad, 50);
      scenes.forEach((s, i) => {
        const x = pad + (i % cols) * (tw + pad);
        const y = head + Math.floor(i / cols) * (th + caption + pad);
        drawFrame(tctx, project, kit, l.id, s.start + Math.min(s.dur * 0.6, 1400), tw / w);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.direction = 'ltr';
        ctx.drawImage(thumb, x, y);
        ctx.fillStyle = '#141833';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = '700 17px "Schibsted Grotesk", system-ui, sans-serif';
        ctx.fillText(`${i + 1}. ${s.label}`, x, y + th + 24);
        ctx.fillStyle = '#555b7a';
        ctx.font = '600 15px "Schibsted Grotesk", system-ui, sans-serif';
        ctx.fillText(`${clock(s.start)} → ${clock(s.start + s.dur)} · ${seconds(s.dur)}`, x, y + th + 42);
      });
      download(await toPng(sheet), `${baseName()}-storyboard-${l.id}.png`);
      await delay(300);
    }
  }

  async function copyPost(id) {
    const text = postText(id);
    const button = $(`[data-act="copy-post"][data-post="${id}"]`);
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Couldn\'t copy';
    }
    setTimeout(() => { if (button.isConnected) button.textContent = 'Copy'; }, 1500);
  }

  async function importProject(file) {
    let loaded;
    try {
      loaded = normalizeProject(JSON.parse(await file.text()));
    } catch {
      window.alert('That file isn\'t a Smarts marketing project.');
      return;
    }
    if (!window.confirm('Replace everything in the Studio with this file? The current project is overwritten once this saves.')) return;
    for (const k of Object.keys(project)) delete project[k];
    Object.assign(project, loaded);
    selected = tl().scenes[0]?.id;
    time = 0;
    playing = false;
    syncPlay();
    recordFormats.clear();
    recordFormats.add(project.format);
    $('[data-url]').value = project.url;
    await scenesChanged();
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
    storyboard: saveStoryboard,
    sheet: () => download(textFile(editSheetCsv(project, kit), 'text/csv'), `${baseName()}-timing.csv`),
    srt: (b) => download(textFile(subtitlesSrt(project, kit, b.dataset.srt), 'application/x-subrip'), `${baseName()}-${b.dataset.srt}.srt`),
    'reset-words': () => {
      delete bag('copy')[selected];
      markChanged();
      drawWords();
      drawScenes();
    },
    'copy-post': (b) => copyPost(b.dataset.post),
    'export-project': () => download(textFile(JSON.stringify(project, null, 2), 'application/json'), `smarts-marketing-project-${new Date().toISOString().slice(0, 10)}.json`),
    'import-project': () => $('[data-import]').click(),
    'new-video': () => switchVideo(createVideo(null)),
    'copy-video': () => switchVideo(createVideo(project.template)),
    'delete-video': () => {
      if (!isCustom() || !window.confirm(`Delete “${own().name}”? Its words and timing go with it.`)) return;
      deleteVideo(project.template);
      return switchVideo(project.template);
    },
    'add-scene': () => {
      addScene($('[data-add-kind]').value);
      return scenesChanged();
    },
    'scene-up': () => {
      moveScene(selected, -1);
      return scenesChanged();
    },
    'scene-down': () => {
      moveScene(selected, 1);
      return scenesChanged();
    },
    'scene-dup': () => {
      duplicateScene(selected);
      return scenesChanged();
    },
    'scene-remove': () => {
      removeScene(selected);
      return scenesChanged();
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
        await delay(400);
      }
    },
  };

  async function switchVideo(id) {
    project.template = id;
    selected = tl().scenes[0]?.id;
    time = 0;
    playing = false;
    syncPlay();
    markChanged();
    await prepareImages(project, kit);
    drawEverything();
  }

  root.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-act]');
    if (action) return actions[action.dataset.act]?.(action);
    const template = e.target.closest('[data-template]');
    if (template) return switchVideo(template.dataset.template);
    const theme = e.target.closest('[data-theme]');
    if (theme) {
      project.look[project.template] = theme.dataset.theme;
      markChanged();
      drawThemes();
      return undefined;
    }
    const format = e.target.closest('[data-format]');
    if (format) {
      if (recordFormats.size === 1) {
        recordFormats.clear();
        recordFormats.add(format.dataset.format);
      }
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
      seekTo(Number(el.value));
    } else if (el.matches('[data-copy]')) {
      const words = bag('copy');
      words[selected] ??= {};
      words[selected][el.dataset.copy] = el.value;
      markChanged();
      refreshWarnings();
    } else if (el.matches('[data-url]')) {
      project.url = el.value.trim();
      markChanged();
      root.querySelectorAll('[data-post-text]').forEach((box) => { box.placeholder = suggestedPost(box.dataset.postText); });
    } else if (el.matches('[data-post-text]')) {
      const posts = bag('posts');
      if (el.value.trim()) posts[el.dataset.postText] = el.value;
      else delete posts[el.dataset.postText];
      markChanged();
    } else if (el.matches('[data-video-name]')) {
      own().name = el.value.trim().slice(0, 60) || 'Untitled video';
      markChanged();
      root.querySelector(`[data-template="${project.template}"] strong`).textContent = own().name;
      $('[data-act="copy-video"]').textContent = `Copy “${own().name}”`;
    } else if (el.matches('[data-scene-label]')) {
      const scene = own()?.scenes.find((s) => s.id === selected);
      if (!scene) return;
      const label = el.value.trim().slice(0, 40);
      if (label) scene.label = label;
      else delete scene.label;
      markChanged();
      $('[data-words-scene]').textContent = videoOf(project).scenes.find((s) => s.id === selected).label;
      drawScenes();
      drawQuestions();
      drawCues();
    }
  });

  root.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.matches('[data-dur]')) {
      const value = Math.min(DUR_MAX, Math.max(DUR_MIN, Number(el.value) || DUR_MIN));
      bag('durs')[el.dataset.dur] = Math.round(value * 1000);
      markChanged();
      drawScenes();
      drawCues();
      drawRecordButton();
    } else if (el.matches('[data-on]')) {
      const off = bag('off');
      if (el.checked) delete off[el.dataset.on];
      else off[el.dataset.on] = true;
      if (!tl().scenes.some((s) => s.id === selected)) selected = tl().scenes[0]?.id;
      markChanged();
      drawScenes();
      drawWords();
      drawCues();
      drawRecordButton();
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
    } else if (el.matches('[data-rec-lang]')) {
      if (el.checked) recordLangs.add(el.dataset.recLang);
      else recordLangs.delete(el.dataset.recLang);
      drawRecordButton();
    } else if (el.matches('[data-rec-format]')) {
      if (el.checked) recordFormats.add(el.dataset.recFormat);
      else recordFormats.delete(el.dataset.recFormat);
      drawRecordButton();
    } else if (el.matches('[data-import]')) {
      const [file] = el.files;
      el.value = '';
      if (file) await importProject(file);
    }
  });

  // Keyboard: the preview's transport, when the focus isn't in a box.
  const onKey = (e) => {
    if (recording || (e.target instanceof Element && e.target.closest('input, textarea, select, button'))) return;
    const { total } = tl();
    const step = e.shiftKey ? 1000 : 1000 / FPS;
    if (e.code === 'Space') actions['toggle-play']();
    else if (e.key === 'ArrowRight') seekTo(time + step);
    else if (e.key === 'ArrowLeft') seekTo(time - step);
    else if (e.key === 'Home') seekTo(0);
    else if (e.key === 'End') seekTo(total - 1);
    else return;
    e.preventDefault();
  };

  document.addEventListener('visibilitychange', leftTab);
  document.addEventListener('keydown', onKey);
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
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', warnLeaving);
    for (const t of takes) URL.revokeObjectURL(t.url);
  };
}
