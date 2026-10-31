import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { AUTO_DELAY, LANGUAGES } from '../shared/config.js';

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT,
      name        TEXT NOT NULL,
      picture     TEXT,
      provider    TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode        TEXT NOT NULL,
      category    TEXT NOT NULL,
      score       INTEGER NOT NULL,
      correct     INTEGER NOT NULL,
      total       INTEGER NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS answers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id     INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question_id  TEXT NOT NULL,
      category     TEXT NOT NULL,
      choice       TEXT,
      correct      INTEGER NOT NULL,
      ms           INTEGER NOT NULL,
      created_at   INTEGER NOT NULL
    );

    -- One row per signed-in browser. The cookie holds a random token; only its hash is stored here.
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      auto_next        INTEGER NOT NULL,
      auto_next_delay  INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );

    -- Players' reports about broken questions. Kept (without the name) if the player deletes their account.
    CREATE TABLE IF NOT EXISTS question_reports (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
      question_id  TEXT NOT NULL,
      reason       TEXT NOT NULL,
      note         TEXT,
      status       TEXT NOT NULL DEFAULT 'open', -- open, fixed or dismissed
      created_at   INTEGER NOT NULL,
      resolved_at  INTEGER
    );

    CREATE INDEX IF NOT EXISTS answers_user ON answers(user_id, id);
    CREATE INDEX IF NOT EXISTS reports_status ON question_reports(status, question_id);
    CREATE INDEX IF NOT EXISTS rounds_user ON rounds(user_id, id);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  `);
  // Migration: rounds quit halfway keep their answers but don't count as finished rounds.
  const cols = db.prepare('PRAGMA table_info(rounds)').all().map((c) => c.name);
  if (!cols.includes('complete')) db.exec('ALTER TABLE rounds ADD COLUMN complete INTEGER NOT NULL DEFAULT 1');
  // Migration: the player's chosen language (null until they pick one).
  const settingCols = db.prepare('PRAGMA table_info(settings)').all().map((c) => c.name);
  if (!settingCols.includes('language')) db.exec('ALTER TABLE settings ADD COLUMN language TEXT');
  return db;
}

export function upsertUser(db, { id, email, name, picture, provider }) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO users (id, email, name, picture, provider, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email, name = excluded.name,
      picture = excluded.picture, last_seen = excluded.last_seen
  `).run(id, email ?? null, name, picture ?? null, provider, now, now);
  return getUser(db, id);
}

export function getUser(db, id) {
  return db.prepare('SELECT id, email, name, picture, provider, created_at FROM users WHERE id = ?').get(id) ?? null;
}

/** Deletes the user; rounds, answers, sessions and settings go with them (ON DELETE CASCADE). */
export function deleteUser(db, id) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
}

// ── Sessions ───────────────────────────────────────────────────

const hashToken = (token) => createHash('sha256').update(token).digest('base64url');

/** Starts a session and returns the token to put in the cookie. */
export function createSession(db, userId, ttlMs) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, now, now + ttlMs);
  return token;
}

export function sessionUser(db, token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.email, u.name, u.picture, u.provider, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?
  `).get(hashToken(token), Date.now()) ?? null;
}

export function deleteSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

export function deleteUserSessions(db, userId) {
  return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
}

export function purgeExpiredSessions(db) {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()).changes;
}

// ── Settings ───────────────────────────────────────────────────

/** The player's saved settings, or null if they have never saved any. */
export function getSettings(db, userId) {
  const row = db.prepare('SELECT auto_next, auto_next_delay, language FROM settings WHERE user_id = ?').get(userId);
  return row ? { autoNext: row.auto_next === 1, autoNextDelay: row.auto_next_delay, language: row.language ?? null } : null;
}

/** Merges `changes` into the saved settings. Throws a 400 error for invalid values. */
export function saveSettings(db, userId, changes) {
  const next = { autoNext: true, autoNextDelay: AUTO_DELAY.fallback, language: null, ...getSettings(db, userId) };
  if ('language' in changes) {
    if (changes.language !== null && !LANGUAGES.includes(changes.language)) throw badRequest(`language must be one of: ${LANGUAGES.join(', ')}.`);
    next.language = changes.language;
  }
  if ('autoNext' in changes) {
    if (typeof changes.autoNext !== 'boolean') throw badRequest('autoNext must be true or false.');
    next.autoNext = changes.autoNext;
  }
  if ('autoNextDelay' in changes) {
    const n = changes.autoNextDelay;
    if (!Number.isInteger(n) || n < AUTO_DELAY.min || n > AUTO_DELAY.max) {
      throw badRequest(`autoNextDelay must be a whole number from ${AUTO_DELAY.min} to ${AUTO_DELAY.max}.`);
    }
    next.autoNextDelay = n;
  }
  db.prepare(`
    INSERT INTO settings (user_id, auto_next, auto_next_delay, language, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      auto_next = excluded.auto_next, auto_next_delay = excluded.auto_next_delay,
      language = excluded.language, updated_at = excluded.updated_at
  `).run(userId, next.autoNext ? 1 : 0, next.autoNextDelay, next.language, Date.now());
  return next;
}

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

// ── Question reports ───────────────────────────────────────────

export const REPORT_STATUSES = ['open', 'fixed', 'dismissed'];

/** Saves a report. A player's second report on the same open question replaces their first. */
export function saveReport(db, userId, { questionId, reason, note }) {
  const now = Date.now();
  const open = db
    .prepare("SELECT id FROM question_reports WHERE user_id = ? AND question_id = ? AND status = 'open'")
    .get(userId, questionId);
  if (open) {
    db.prepare('UPDATE question_reports SET reason = ?, note = ?, created_at = ? WHERE id = ?').run(reason, note, now, open.id);
  } else {
    db.prepare('INSERT INTO question_reports (user_id, question_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, questionId, reason, note, now);
  }
}

export function listReports(db, status) {
  return db.prepare(`
    SELECT r.id, r.question_id AS questionId, r.reason, r.note, r.status, r.created_at, r.resolved_at, u.name AS userName
    FROM question_reports r LEFT JOIN users u ON u.id = r.user_id
    WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 1000
  `).all(status);
}

/** Closes every open report on a question as fixed or dismissed. Returns how many. */
export function resolveReports(db, questionId, status) {
  return db
    .prepare("UPDATE question_reports SET status = ?, resolved_at = ? WHERE question_id = ? AND status = 'open'")
    .run(status, Date.now(), questionId).changes;
}

// ── Export ─────────────────────────────────────────────────────

/** Everything stored about one user, for the "Download my data" button. */
export function exportUser(db, userId) {
  const user = db.prepare('SELECT id, email, name, picture, provider, created_at, last_seen FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  return {
    exportedAt: new Date().toISOString(),
    user,
    settings: getSettings(db, userId),
    sessions: db.prepare('SELECT created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at').all(userId),
    rounds: db.prepare('SELECT id, mode, category, score, correct, total, complete, created_at FROM rounds WHERE user_id = ? ORDER BY id').all(userId),
    answers: db.prepare('SELECT round_id, question_id, category, choice, correct, ms, created_at FROM answers WHERE user_id = ? ORDER BY id').all(userId),
    reports: db.prepare('SELECT question_id, reason, note, status, created_at FROM question_reports WHERE user_id = ? ORDER BY id').all(userId),
  };
}

/** Writes a consistent copy of the live database to `file` (safe while the server is running). */
export function backupDb(db, file) {
  mkdirSync(dirname(file), { recursive: true });
  db.prepare('VACUUM INTO ?').run(file);
}

export function saveRound(db, userId, { mode, category, graded, complete = true }) {
  const now = Date.now();
  const score = graded.reduce((s, a) => s + a.points, 0);
  const correct = graded.filter((a) => a.correct).length;
  db.exec('BEGIN');
  try {
    const { lastInsertRowid: roundId } = db
      .prepare('INSERT INTO rounds (user_id, mode, category, score, correct, total, created_at, complete) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(userId, mode, category, score, correct, graded.length, now, complete ? 1 : 0);
    const ins = db.prepare(
      'INSERT INTO answers (round_id, user_id, question_id, category, choice, correct, ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const a of graded) ins.run(roundId, userId, a.id, a.cat, a.choice, a.correct ? 1 : 0, a.ms, now);
    db.exec('COMMIT');
    return { roundId: Number(roundId), score, correct, total: graded.length };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getStats(db, userId, { tzOffsetMin = 0 } = {}) {
  const totals = db
    .prepare(`
      SELECT COUNT(*) AS answered,
             COALESCE(SUM(correct), 0) AS correct,
             COALESCE(AVG(CASE WHEN correct = 1 THEN ms END), 0) AS avgMs,
             COALESCE(MIN(CASE WHEN correct = 1 THEN ms END), 0) AS fastestMs,
             COALESCE(SUM(ms), 0) AS totalMs,
             COALESCE(SUM(CASE WHEN choice IS NULL THEN 1 ELSE 0 END), 0) AS timeouts
      FROM answers WHERE user_id = ?`)
    .get(userId);

  const byCategory = db
    .prepare(`
      SELECT category,
             COUNT(*) AS answered,
             SUM(correct) AS correct,
             COUNT(DISTINCT question_id) AS seen,
             COUNT(DISTINCT CASE WHEN correct = 1 THEN question_id END) AS mastered,
             COALESCE(AVG(CASE WHEN correct = 1 THEN ms END), 0) AS avgMs
      FROM answers WHERE user_id = ? GROUP BY category
    `)
    .all(userId);

  const roundAgg = db
    .prepare(`
      SELECT COUNT(*) AS rounds, COALESCE(MAX(score), 0) AS bestScore, COALESCE(AVG(score), 0) AS avgScore,
             COALESCE(SUM(CASE WHEN correct = total THEN 1 ELSE 0 END), 0) AS perfectRounds
      FROM rounds WHERE user_id = ? AND complete = 1`)
    .get(userId);

  const recent = db
    .prepare('SELECT id, mode, category, score, correct, total, created_at FROM rounds WHERE user_id = ? AND complete = 1 ORDER BY id DESC LIMIT 8')
    .all(userId);

  // Best run of consecutive correct answers, and the current one.
  let best = 0;
  let run = 0;
  for (const row of db.prepare('SELECT correct FROM answers WHERE user_id = ? ORDER BY id').all(userId)) {
    run = row.correct ? run + 1 : 0;
    if (run > best) best = run;
  }

  // Answers per local day for the last 14 days.
  const dayMs = 86_400_000;
  const shift = -tzOffsetMin * 60_000; // getTimezoneOffset() is minutes *behind* UTC
  const today = Math.floor((Date.now() + shift) / dayMs);
  const since = (today - 13) * dayMs - shift;
  const dayRows = db
    .prepare(`
      SELECT CAST((created_at + ?) / ? AS INTEGER) AS day, COUNT(*) AS answered, SUM(correct) AS correct
      FROM answers WHERE user_id = ? AND created_at >= ? GROUP BY day
    `)
    .all(shift, dayMs, userId, since);
  const byDay = new Map(dayRows.map((r) => [r.day, r]));
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = today - 13 + i;
    const r = byDay.get(d);
    return { date: new Date(d * dayMs).toISOString().slice(0, 10), answered: r?.answered ?? 0, correct: r?.correct ?? 0 };
  });

  // Day streaks: consecutive local days with at least one answer.
  const playedDays = db
    .prepare('SELECT DISTINCT CAST((created_at + ?) / ? AS INTEGER) AS day FROM answers WHERE user_id = ? ORDER BY day')
    .all(shift, dayMs, userId)
    .map((r) => r.day);
  let bestDayStreak = 0;
  let runDays = 0;
  for (let i = 0; i < playedDays.length; i++) {
    runDays = i > 0 && playedDays[i] === playedDays[i - 1] + 1 ? runDays + 1 : 1;
    bestDayStreak = Math.max(bestDayStreak, runDays);
  }
  const lastDay = playedDays.at(-1);
  // A streak is still alive if you played today or yesterday.
  const dayStreak = lastDay !== undefined && lastDay >= today - 1 ? runDays : 0;

  // This week (last 7 local days) vs the 7 days before.
  const week = (fromDay, toDay) =>
    db
      .prepare('SELECT COUNT(*) AS answered, COALESCE(SUM(correct), 0) AS correct FROM answers WHERE user_id = ? AND created_at >= ? AND created_at < ?')
      .get(userId, fromDay * dayMs - shift, toDay * dayMs - shift);
  const thisWeek = week(today - 6, today + 1);
  const lastWeek = week(today - 13, today - 6);

  // The questions you get wrong most often.
  const missed = db
    .prepare(`
      SELECT question_id AS id, SUM(1 - correct) AS wrong, SUM(correct) AS right, MAX(created_at) AS last
      FROM answers WHERE user_id = ?
      GROUP BY question_id HAVING wrong > 0
      ORDER BY wrong DESC, last DESC LIMIT 12`)
    .all(userId);

  // Questions answered wrong in the last 10 rounds and not answered right since:
  // Quick rounds bring a few of them back for another try.
  const recentMissed = db
    .prepare(`
      SELECT a.question_id AS id FROM answers a
      WHERE a.user_id = ? AND a.correct = 0
        AND a.round_id IN (SELECT id FROM rounds WHERE user_id = ? ORDER BY id DESC LIMIT 10)
        AND a.id = (SELECT MAX(b.id) FROM answers b WHERE b.user_id = a.user_id AND b.question_id = a.question_id)`)
    .all(userId, userId)
    .map((r) => r.id);

  // The round just played, so the next one doesn't open with the same questions.
  const lastRoundIds = db
    .prepare('SELECT question_id AS id FROM answers WHERE round_id = (SELECT MAX(id) FROM rounds WHERE user_id = ?)')
    .all(userId)
    .map((r) => r.id);

  const seenIds = db.prepare('SELECT DISTINCT question_id AS id FROM answers WHERE user_id = ?').all(userId).map((r) => r.id);
  const masteredIds = db
    .prepare('SELECT DISTINCT question_id AS id FROM answers WHERE user_id = ? AND correct = 1')
    .all(userId)
    .map((r) => r.id);

  return {
    answered: totals.answered,
    correct: totals.correct,
    avgCorrectMs: Math.round(totals.avgMs),
    fastestMs: totals.fastestMs,
    totalMs: totals.totalMs,
    timeouts: totals.timeouts,
    rounds: roundAgg.rounds,
    bestScore: roundAgg.bestScore,
    avgScore: Math.round(roundAgg.avgScore),
    perfectRounds: roundAgg.perfectRounds,
    dayStreak,
    bestDayStreak,
    thisWeek,
    lastWeek,
    missed,
    bestStreak: best,
    currentStreak: run,
    byCategory,
    recent,
    days,
    seenIds,
    masteredIds,
    recentMissed,
    lastRoundIds,
  };
}
