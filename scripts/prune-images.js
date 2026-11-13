// Deletes downloaded pictures that no question in the bank uses any more (after questions are
// removed), and takes them out of public/img/manifest.json. The opposite of fetch-images.
//
//   npm run prune-images              delete them
//   npm run prune-images -- --dry-run only list what would go
//
// Looks at public/img/q/ (photos), public/img/flags/ and public/img/countries/. A file that a
// Leveling stage on the dashboard uses as its picture (/img/...) is kept too.

import { accessSync, constants, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { QUESTIONS } from '../shared/questions.js';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const IMG = join(PUBLIC, 'img');
const DRY = process.argv.includes('--dry-run');
try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* no .env file */ }

const MANIFEST = join(IMG, 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
} catch {
  console.log('No public/img/manifest.json: nothing has been downloaded, so there is nothing to prune.');
  process.exit(0);
}
manifest.photos ||= {};
manifest.flags ||= [];
manifest.countries ||= [];

// ── What the bank still uses ───────────────────────────────────

const used = new Set(); // addresses under /img/, as the browser asks for them
const bankIds = new Set(QUESTIONS.map((q) => q.id));
const flagCodes = new Set();
const countryIsos = new Set();
for (const q of QUESTIONS) {
  const v = q.visual;
  if (v.type === 'wiki' && manifest.photos[q.id]) used.add(manifest.photos[q.id].src);
  if (v.type === 'flag') flagCodes.add(v.code);
  if (v.type === 'country') countryIsos.add(v.iso);
}
for (const code of flagCodes) used.add(`/img/flags/${code}.png`);
for (const iso of countryIsos) used.add(`/img/countries/${iso}.svg`);

// Pictures that admins picked for Leveling stage questions (stored in the database).
const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data');
const DB_FILE = process.env.DB_FILE ? resolve(process.env.DB_FILE) : join(DATA_DIR, 'smarts.db');
let stagePictures = 0;
if (existsSync(DB_FILE)) {
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  try {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'stage_questions'").get();
    if (hasTable) {
      for (const { picture } of db.prepare("SELECT picture FROM stage_questions WHERE picture LIKE '/img/%'").all()) {
        used.add(decodeURI(picture));
        stagePictures++;
      }
    }
  } finally {
    db.close();
  }
}

// ── What to delete ─────────────────────────────────────────────

const doomed = []; // { file, address, size }
for (const dir of ['q', 'flags', 'countries']) {
  const folder = join(IMG, dir);
  if (!existsSync(folder)) continue;
  for (const name of readdirSync(folder)) {
    const file = join(folder, name);
    const stat = statSync(file);
    if (!stat.isFile()) continue;
    const address = `/img/${dir}/${name}`;
    if (!used.has(address)) doomed.push({ file, address, size: stat.size });
  }
}

const doomedAddresses = new Set(doomed.map((d) => d.address));
const photoEntries = Object.entries(manifest.photos).filter(([id, p]) => !bankIds.has(id) && !used.has(p.src));
const keptPhotos = Object.fromEntries(Object.entries(manifest.photos).filter(([id, p]) => bankIds.has(id) || used.has(p.src)));
const keptFlags = manifest.flags.filter((code) => used.has(`/img/flags/${code}.png`));
const keptCountries = manifest.countries.filter((iso) => used.has(`/img/countries/${iso}.svg`));
const manifestRemoved = photoEntries.length + (manifest.flags.length - keptFlags.length) + (manifest.countries.length - keptCountries.length);

// ── Report and delete ──────────────────────────────────────────

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const freed = doomed.reduce((sum, d) => sum + d.size, 0);

if (!doomed.length && !manifestRemoved) {
  console.log('Every downloaded picture is still used. Nothing to prune.');
  process.exit(0);
}

// Deleting needs the account that owns the pictures (on a server, the one the app runs as).
// Check before touching anything, so a permission problem never leaves half the job done.
if (!DRY) {
  const dirs = new Set([dirname(MANIFEST), ...doomed.map((d) => dirname(d.file))]);
  const blocked = [...dirs].filter((dir) => { try { accessSync(dir, constants.W_OK); return false; } catch { return true; } });
  if (blocked.length) {
    console.error(`Can't delete in ${blocked.join(', ')}: this account may not change those files.`);
    console.error('Run it as the account that owns them, for example: sudo -u smarts npm run prune-images');
    console.error('Nothing was deleted.');
    process.exit(1);
  }
}

const failed = [];
for (const d of doomed) {
  if (!DRY) {
    try {
      rmSync(d.file);
    } catch (err) {
      failed.push(d.address);
      console.error(`  could not delete ${d.address}: ${err.code || err.message}`);
      continue;
    }
  }
  console.log(`  ${DRY ? 'would delete' : 'deleted'} ${d.address} (${Math.round(d.size / 1024)} KB)`);
}
for (const [id] of photoEntries) if (!doomedAddresses.has(manifest.photos[id].src)) console.log(`  ${DRY ? 'would drop' : 'dropped'} manifest entry ${id} (no file)`);

if (!DRY) {
  // A file that couldn't be deleted keeps its manifest entry, so the two stay in step.
  const stays = new Set(failed);
  for (const [id, p] of Object.entries(manifest.photos)) if (stays.has(p.src)) keptPhotos[id] = p;
  manifest.photos = keptPhotos;
  manifest.flags = manifest.flags.filter((code) => keptFlags.includes(code) || stays.has(`/img/flags/${code}.png`));
  manifest.countries = manifest.countries.filter((iso) => keptCountries.includes(iso) || stays.has(`/img/countries/${iso}.svg`));
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
}

const verb = DRY ? 'Would remove' : 'Removed';
const done = doomed.length - failed.length;
console.log(`\n${verb} ${done} file${done === 1 ? '' : 's'} (${mb(freed)}) and ${manifestRemoved} manifest entr${manifestRemoved === 1 ? 'y' : 'ies'}.`);
if (stagePictures) console.log(`Kept ${stagePictures} picture${stagePictures === 1 ? '' : 's'} used by Leveling stages.`);
if (DRY) console.log('Dry run: nothing was changed. Run without --dry-run to delete.');
if (failed.length) {
  console.error(`
${failed.length} file${failed.length === 1 ? '' : 's'} could not be deleted (see above). Run it again as the account that owns them.`);
  process.exitCode = 1;
}
