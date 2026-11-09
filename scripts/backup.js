// Copies the live database to a dated file, and keeps only the newest few copies.
// Safe to run while the server is running.
//
//   npm run backup                      -> <data dir>/backups/smarts-YYYY-MM-DDTHH-MM-SS-mmm.db
//   npm run backup -- /mnt/backups 14   -> into /mnt/backups, keeping the newest 14
//
// Point the target at a different disk (or sync it off the machine) so a lost disk
// doesn't take the backups with it.

import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb, backupDb } from '../server/db.js';

const ROOT = resolve(import.meta.dirname, '..');
try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* no .env file */ }

const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data');
const DB_FILE = process.env.DB_FILE ? resolve(process.env.DB_FILE) : join(DATA_DIR, 'smarts.db');
const target = resolve(process.argv[2] || join(DATA_DIR, 'backups'));
const keep = Math.max(1, Number(process.argv[3]) || 7);

const stamp = new Date().toISOString().slice(0, 23).replace(/[:.]/g, '-');
const file = join(target, `smarts-${stamp}.db`);

const db = openDb(DB_FILE);
backupDb(db, file);
db.close();
console.log(`Backed up ${DB_FILE}\n       to ${file}`);

const old = readdirSync(target).filter((f) => /^smarts-.*\.db$/.test(f)).sort().slice(0, -keep);
for (const f of old) rmSync(join(target, f));
if (old.length) console.log(`Removed ${old.length} older backup${old.length === 1 ? '' : 's'} (keeping ${keep}).`);
