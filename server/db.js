import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  AUTO_DELAY, BACK_BUTTON, BOARD, LANGUAGES, PROFILE, STAGE, STAGE_PICTURE_HOSTS, XP, inQuickRounds, levelFor, pointsFor, secondsFor, stageCleared, xpForRound,
} from '../shared/config.js';
import { QUESTION_BY_ID } from '../shared/questions.js';
import { avatarLevel, parseAvatar, randomAvatar } from '../shared/avatars.js';
import { isCountry } from '../shared/countries.js';
import { reviewState } from './review.js';

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA cache_size = -16000;   -- up to 16 MB of pages kept in memory
    PRAGMA temp_store = MEMORY;   -- sorting for the boards happens in memory, not in temp files

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

    -- What players do (see EVENTS in shared/config.js). props is a small JSON object.
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      props       TEXT,
      created_at  INTEGER NOT NULL
    );

    -- How a player appears to others. Created at first sign-in with a random avatar.
    CREATE TABLE IF NOT EXISTS profiles (
      user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      avatar       TEXT NOT NULL,
      country      TEXT,
      hidden       INTEGER NOT NULL DEFAULT 0, -- 1: shown as a hidden player on public boards
      friend_code  TEXT NOT NULL UNIQUE,
      tz_offset    INTEGER NOT NULL DEFAULT 0, -- minutes behind UTC, as from getTimezoneOffset()
      updated_at   INTEGER NOT NULL
    );

    -- Friendships, stored once in each direction.
    CREATE TABLE IF NOT EXISTS friends (
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (user_id, friend_id)
    ) WITHOUT ROWID;

    -- The Daily Challenge's questions for each date, picked the first time someone asks.
    CREATE TABLE IF NOT EXISTS daily_challenges (
      day           TEXT PRIMARY KEY,
      number        INTEGER NOT NULL,
      question_ids  TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    -- One try per player per day: the row is made when they start, and scored when they finish.
    CREATE TABLE IF NOT EXISTS daily_results (
      day          TEXT NOT NULL,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      round_id     INTEGER REFERENCES rounds(id) ON DELETE SET NULL,
      score        INTEGER,
      correct      INTEGER,
      total        INTEGER,
      ms           INTEGER,
      started_at   INTEGER NOT NULL,
      finished_at  INTEGER,
      PRIMARY KEY (day, user_id)
    ) WITHOUT ROWID;

    -- Two players, the same questions. The challenger plays first; whoever opens the link next
    -- (or the friend it was sent to) plays second.
    CREATE TABLE IF NOT EXISTS duels (
      id                  TEXT PRIMARY KEY,
      challenger_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      opponent_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
      invited_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
      category            TEXT NOT NULL,
      question_ids        TEXT NOT NULL,
      challenger_score    INTEGER,
      challenger_correct  INTEGER,
      challenger_ms       INTEGER,
      challenger_round    INTEGER,
      opponent_score      INTEGER,
      opponent_correct    INTEGER,
      opponent_ms         INTEGER,
      opponent_round      INTEGER,
      rematch_of          TEXT,
      created_at          INTEGER NOT NULL,
      accepted_at         INTEGER,
      finished_at         INTEGER
    );

    -- A player's one go at a Daily or a side of a duel, played on the server, question by question.
    CREATE TABLE IF NOT EXISTS plays (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind          TEXT NOT NULL,
      ref           TEXT NOT NULL,
      side          TEXT,
      question_ids  TEXT NOT NULL,
      idx           INTEGER NOT NULL DEFAULT 0,
      opened_at     INTEGER,
      answers       TEXT NOT NULL DEFAULT '[]',
      started_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      finished_at   INTEGER,
      UNIQUE (kind, ref, user_id)
    );

    -- Browsers that agreed to receive reminders (Web Push).
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint    TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    -- Reminders already sent, so none goes out twice.
    CREATE TABLE IF NOT EXISTS notifications_sent (
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,
      ref         TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (user_id, kind, ref)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS answers_user ON answers(user_id, id);
    -- "Questions you got wrong and haven't got right since" looks up each question's latest answer.
    CREATE INDEX IF NOT EXISTS answers_user_question ON answers(user_id, question_id, id);
    CREATE INDEX IF NOT EXISTS answers_round ON answers(round_id);
    CREATE INDEX IF NOT EXISTS daily_board ON daily_results(day, score DESC, ms);
    CREATE INDEX IF NOT EXISTS daily_user ON daily_results(user_id, day);
    CREATE INDEX IF NOT EXISTS duels_challenger ON duels(challenger_id, created_at);
    CREATE INDEX IF NOT EXISTS duels_opponent ON duels(opponent_id, created_at);
    CREATE INDEX IF NOT EXISTS duels_invited ON duels(invited_id, created_at);
    CREATE INDEX IF NOT EXISTS plays_open ON plays(updated_at) WHERE finished_at IS NULL;
    CREATE INDEX IF NOT EXISTS push_user ON push_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS events_name ON events(name, created_at);
    CREATE INDEX IF NOT EXISTS events_user ON events(user_id, created_at);
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
  migrate(db);
  return db;
}

// Numbered migrations, run once each in order. PRAGMA user_version remembers the last one done.
const MIGRATIONS = [
  // 1: scoring changed from 100 + up to 50 per answer to 1 + up to 2. Old rounds are scored again
  // from their answers, so no score on the old scale is left anywhere.
  (db) => {
    const answers = db.prepare('SELECT question_id, category, correct, ms FROM answers WHERE round_id = ?');
    const update = db.prepare('UPDATE rounds SET score = ? WHERE id = ?');
    for (const { id } of db.prepare('SELECT id FROM rounds').all()) {
      let score = 0;
      for (const a of answers.all(id)) {
        const q = QUESTION_BY_ID.get(a.question_id) || { cat: a.category };
        score += pointsFor(a.correct === 1, a.ms, secondsFor(q));
      }
      update.run(score, id);
    }
  },
  // 2: reminder choices.
  (db) => {
    db.exec('ALTER TABLE settings ADD COLUMN notify_daily INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE settings ADD COLUMN notify_friends INTEGER NOT NULL DEFAULT 0');
  },
  // 3: when the Back arrow shows (see BACK_BUTTON).
  (db) => db.exec("ALTER TABLE settings ADD COLUMN back_button TEXT NOT NULL DEFAULT 'phones'"),
  // 4: the default wait before the next question went from 4 seconds to 2. Players on 4 had the
  // old default (a chosen 4 can't be told apart from it), so they move to the new one.
  (db) => db.exec('UPDATE settings SET auto_next_delay = 2 WHERE auto_next_delay = 4'),
  // 5: who hasn't seen a finished duel's result yet (the player who finished first).
  (db) => db.exec('ALTER TABLE duels ADD COLUMN result_unseen_by TEXT'),
  // 6: player levels. XP is kept on the profile so boards don't have to add up every player's
  // rounds. Players start with what the rounds they've already finished earn.
  (db) => {
    db.exec('ALTER TABLE profiles ADD COLUMN xp INTEGER NOT NULL DEFAULT 0');
    const set = db.prepare('UPDATE profiles SET xp = ? WHERE user_id = ?');
    for (const { user_id: id } of db.prepare('SELECT user_id FROM profiles').all()) set.run(earnedXp(db, id), id);
  },
  // 7: Leveling. Stages and their questions are only ever written on the admin dashboard.
  (db) => db.exec(`
    CREATE TABLE stages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      position    INTEGER NOT NULL,
      published   INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE stage_questions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      stage_id    INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL,
      prompt      TEXT NOT NULL,
      answer      TEXT NOT NULL,
      wrong       TEXT NOT NULL, -- JSON list of the wrong answers
      picture     TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX stage_questions_stage ON stage_questions(stage_id, position);
    -- One row per player and stage. cleared_at is set once, by the try that earns the bonus.
    CREATE TABLE stage_results (
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stage_id      INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
      attempts      INTEGER NOT NULL DEFAULT 0,
      best_correct  INTEGER NOT NULL DEFAULT 0,
      best_total    INTEGER NOT NULL DEFAULT 0,
      best_score    INTEGER NOT NULL DEFAULT 0,
      cleared_at    INTEGER,
      last_correct  INTEGER NOT NULL DEFAULT 0,
      last_total    INTEGER NOT NULL DEFAULT 0,
      last_score    INTEGER NOT NULL DEFAULT 0,
      last_xp       INTEGER NOT NULL DEFAULT 0,
      last_bonus    INTEGER NOT NULL DEFAULT 0,
      last_at       INTEGER,
      PRIMARY KEY (user_id, stage_id)
    ) WITHOUT ROWID;
    CREATE INDEX stage_results_stage ON stage_results(stage_id);
    ALTER TABLE plays ADD COLUMN content TEXT; -- a Leveling round's own copy of its questions
  `),
];

/** The XP all of a player's finished rounds add up to. */
const earnedXp = (db, userId) =>
  db.prepare('SELECT category, score FROM rounds WHERE user_id = ? AND complete = 1').all(userId)
    .reduce((sum, r) => sum + xpForRound(r.category, r.score), 0);

/** Lets SQLite refresh its statistics for the query planner. Cheap; run now and then. */
export function optimizeDb(db) {
  db.exec('PRAGMA optimize');
}

function migrate(db) {
  const done = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = done; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      MIGRATIONS[i](db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
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
  const row = db.prepare('SELECT auto_next, auto_next_delay, language, notify_daily, notify_friends, back_button FROM settings WHERE user_id = ?').get(userId);
  return row ? {
    autoNext: row.auto_next === 1, autoNextDelay: row.auto_next_delay, language: row.language ?? null,
    notifyDaily: row.notify_daily === 1, notifyFriends: row.notify_friends === 1, backButton: row.back_button,
  } : null;
}

/** Merges `changes` into the saved settings. Throws a 400 error for invalid values. */
export function saveSettings(db, userId, changes) {
  const next = { autoNext: true, autoNextDelay: AUTO_DELAY.fallback, language: null, notifyDaily: false, notifyFriends: false, backButton: 'phones', ...getSettings(db, userId) };
  for (const name of ['notifyDaily', 'notifyFriends']) {
    if (!(name in changes)) continue;
    if (typeof changes[name] !== 'boolean') throw badRequest(`${name} must be true or false.`);
    next[name] = changes[name];
  }
  if ('language' in changes) {
    if (changes.language !== null && !LANGUAGES.includes(changes.language)) throw badRequest(`language must be one of: ${LANGUAGES.join(', ')}.`);
    next.language = changes.language;
  }
  if ('backButton' in changes) {
    if (!BACK_BUTTON.includes(changes.backButton)) throw badRequest(`backButton must be one of: ${BACK_BUTTON.join(', ')}.`);
    next.backButton = changes.backButton;
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
    INSERT INTO settings (user_id, auto_next, auto_next_delay, language, notify_daily, notify_friends, back_button, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      auto_next = excluded.auto_next, auto_next_delay = excluded.auto_next_delay, language = excluded.language,
      notify_daily = excluded.notify_daily, notify_friends = excluded.notify_friends, back_button = excluded.back_button,
      updated_at = excluded.updated_at
  `).run(userId, next.autoNext ? 1 : 0, next.autoNextDelay, next.language, next.notifyDaily ? 1 : 0, next.notifyFriends ? 1 : 0, next.backButton, Date.now());
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
    events: db.prepare('SELECT name, props, created_at FROM events WHERE user_id = ? ORDER BY id').all(userId)
      .map((e) => ({ ...e, props: e.props ? JSON.parse(e.props) : null })),
    profile: db.prepare('SELECT name, avatar, country, hidden, friend_code, xp, updated_at FROM profiles WHERE user_id = ?').get(userId) ?? null,
    friends: db.prepare('SELECT p.name, f.created_at FROM friends f JOIN profiles p ON p.user_id = f.friend_id WHERE f.user_id = ? ORDER BY f.created_at').all(userId),
    daily: db.prepare('SELECT day, score, correct, total, ms, started_at, finished_at FROM daily_results WHERE user_id = ? ORDER BY day').all(userId),
    duels: db.prepare('SELECT id, category, challenger_id = ? AS you_challenged, challenger_score, opponent_score, created_at, finished_at FROM duels WHERE challenger_id = ? OR opponent_id = ? ORDER BY created_at')
      .all(userId, userId, userId),
    leveling: db.prepare(`
      SELECT s.title, r.attempts, r.best_correct, r.best_total, r.best_score, r.cleared_at, r.last_at
      FROM stage_results r JOIN stages s ON s.id = r.stage_id WHERE r.user_id = ? ORDER BY s.position`).all(userId),
    reminderDevices: db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(userId).n,
  };
}

// ── Events and the Players dashboard ───────────────────────────

/** Records one event (see EVENTS in shared/config.js). `props` is a small plain object or null. */
export function logEvent(db, userId, name, props = null) {
  db.prepare('INSERT INTO events (user_id, name, props, created_at) VALUES (?, ?, ?, ?)')
    .run(userId ?? null, name, props ? JSON.stringify(props) : null, Date.now());
}

const DAY_MS = 86_400_000;
const RETURN_DAYS = [1, 7, 30];

/**
 * Daily and monthly players, how many come back 1, 7 and 30 days after their first day, and
 * event counts. A player is active on a local day when they played a round or logged an event.
 * Days are counted in the viewer's time zone (`tzOffsetMin` as from getTimezoneOffset()).
 */
export function getRetention(db, { tzOffsetMin = 0, eventNames = [] } = {}) {
  const shift = -tzOffsetMin * 60_000;
  const today = Math.floor((Date.now() + shift) / DAY_MS);
  const rows = db.prepare(`
    SELECT user_id AS u, CAST((created_at + ?) / ? AS INTEGER) AS day FROM rounds
    UNION
    SELECT user_id, CAST((created_at + ?) / ? AS INTEGER) FROM events WHERE user_id IS NOT NULL
  `).all(shift, DAY_MS, shift, DAY_MS);

  const daysOf = new Map(); // user -> Set of active days
  for (const { u, day } of rows) {
    if (!daysOf.has(u)) daysOf.set(u, new Set());
    daysOf.get(u).add(day);
  }
  const firstDay = new Map([...daysOf].map(([u, days]) => [u, Math.min(...days)]));
  const activeOn = (from, to) => [...daysOf.values()].filter((days) => [...days].some((d) => d >= from && d <= to)).length;
  const iso = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

  // The last 30 days, split into players new that day and players coming back.
  const daily = Array.from({ length: 30 }, (_, i) => {
    const day = today - 29 + i;
    let active = 0;
    let fresh = 0;
    for (const [u, days] of daysOf) {
      if (!days.has(day)) continue;
      active++;
      if (firstDay.get(u) === day) fresh++;
    }
    return { date: iso(day), active, new: fresh };
  });

  // Of the players whose first day was f, how many were active again on day f + n. Only
  // cohorts whose day f + n is already over count, so today's half-finished day doesn't drag it down.
  const returned = (users, n) => {
    const eligible = users.filter((u) => firstDay.get(u) + n < today);
    const back = eligible.filter((u) => daysOf.get(u).has(firstDay.get(u) + n));
    return { n, eligible: eligible.length, back: back.length };
  };
  const everyone = [...daysOf.keys()];

  // Weekly cohorts by first day, the newest 8 weeks (week 0 is the last 7 days).
  const cohorts = Array.from({ length: 8 }, (_, w) => {
    const to = today - w * 7;
    const from = to - 6;
    const users = everyone.filter((u) => firstDay.get(u) >= from && firstDay.get(u) <= to);
    return { from: iso(from), to: iso(to), players: users.length, returns: RETURN_DAYS.map((n) => returned(users, n)) };
  });

  // Calendar months (in the viewer's time zone), the newest 6.
  const monthOf = (day) => iso(day).slice(0, 7);
  const monthly = new Map();
  for (const days of daysOf.values()) {
    for (const m of new Set([...days].map(monthOf))) monthly.set(m, (monthly.get(m) || 0) + 1);
  }
  const months = [];
  for (let d = new Date(today * DAY_MS), i = 0; i < 6; i++) {
    const m = d.toISOString().slice(0, 7);
    months.unshift({ month: m, players: monthly.get(m) || 0 });
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  }

  // Event counts for the last 7 and 30 days, and how many players each event came from.
  const since = (n) => (today - n + 1) * DAY_MS - shift;
  const counts = db.prepare(`
    SELECT name,
           SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS week,
           COUNT(*) AS month,
           COUNT(DISTINCT user_id) AS players
    FROM events WHERE created_at >= ? GROUP BY name
  `).all(since(7), since(30));
  const byName = new Map(counts.map((c) => [c.name, c]));
  const events = [...new Set([...eventNames, ...byName.keys()])].map((name) => {
    const c = byName.get(name);
    return { name, week: c?.week ?? 0, month: c?.month ?? 0, players: c?.players ?? 0 };
  });

  // Players who signed up in the last 30 days: how many started a round, how many finished
  // one, and the median time from signing up to their first finished round.
  const joined = db.prepare(`
    SELECT u.created_at AS joined,
           (SELECT MIN(created_at) FROM events WHERE user_id = u.id AND name = 'round_started') AS started,
           (SELECT MIN(created_at) FROM rounds WHERE user_id = u.id AND complete = 1) AS finished
    FROM users u WHERE u.created_at >= ?
  `).all(since(30));
  const waits = joined.filter((j) => j.finished).map((j) => j.finished - j.joined).sort((a, b) => a - b);
  const firstRound = {
    players: joined.length,
    started: joined.filter((j) => j.started || j.finished).length,
    finished: waits.length,
    medianMin: waits.length ? Math.round(waits[Math.floor((waits.length - 1) / 2)] / 60_000) : null,
  };

  return {
    today: iso(today),
    players: everyone.length,
    dau: daily.at(-1).active,
    dauAvg7: Math.round((daily.slice(-7).reduce((s, d) => s + d.active, 0) / 7) * 10) / 10,
    wau: activeOn(today - 6, today),
    mau: activeOn(today - 29, today),
    newLast30: everyone.filter((u) => firstDay.get(u) > today - 30).length,
    returns: RETURN_DAYS.map((n) => returned(everyone, n)),
    daily,
    cohorts,
    months,
    events,
    firstRound,
  };
}

/** How many rounds a player has finished: Quick, topic, Daily and duel rounds, not ones they left. */
export const finishedRounds = (db, userId) =>
  db.prepare('SELECT COUNT(*) AS n FROM rounds WHERE user_id = ? AND complete = 1').get(userId).n;

/** Writes a consistent copy of the live database to `file` (safe while the server is running). */
export function backupDb(db, file) {
  mkdirSync(dirname(file), { recursive: true });
  db.prepare('VACUUM INTO ?').run(file);
}

/** Writes a round and its answers and adds its XP. Runs inside the caller's transaction. */
function insertRound(db, userId, { mode, category, graded, complete = true, bonusXp = 0 }) {
  const now = Date.now();
  const score = graded.reduce((s, a) => s + a.points, 0);
  const correct = graded.filter((a) => a.correct).length;
  const { lastInsertRowid: roundId } = db
    .prepare('INSERT INTO rounds (user_id, mode, category, score, correct, total, created_at, complete) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, mode, category, score, correct, graded.length, now, complete ? 1 : 0);
  const ins = db.prepare(
    'INSERT INTO answers (round_id, user_id, question_id, category, choice, correct, ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const a of graded) ins.run(roundId, userId, a.id, a.cat, a.choice, a.correct ? 1 : 0, a.ms, now);
  const xpGained = complete ? xpForRound(category, score) + bonusXp : 0;
  const xp = db.prepare('UPDATE profiles SET xp = xp + ? WHERE user_id = ? RETURNING xp').get(xpGained, userId)?.xp ?? 0;
  return { roundId: Number(roundId), score, correct, total: graded.length, xpGained, xp };
}

/** Runs `work` in one transaction: all of it is saved, or none. */
function inTransaction(db, work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const saveRound = (db, userId, round) => inTransaction(db, () => insertRound(db, userId, round));

/**
 * Day streaks: runs of consecutive local days with at least one answer. The current one is
 * still alive if the player played today or yesterday.
 */
export function dayStreaks(db, userId, tzOffsetMin = 0) {
  const shift = -tzOffsetMin * 60_000;
  const today = Math.floor((Date.now() + shift) / DAY_MS);
  const days = db
    .prepare('SELECT DISTINCT CAST((created_at + ?) / ? AS INTEGER) AS day FROM answers WHERE user_id = ? ORDER BY day')
    .all(shift, DAY_MS, userId)
    .map((r) => r.day);
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const last = days.at(-1);
  return { current: last !== undefined && last >= today - 1 ? run : 0, best };
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
             COUNT(DISTINCT CASE WHEN correct = 1 THEN question_id END) AS gotRight,
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

  const { current: dayStreak, best: bestDayStreak } = dayStreaks(db, userId, tzOffsetMin);

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
      FROM answers WHERE user_id = ? AND category != 'stage'
      GROUP BY question_id HAVING wrong > 0
      ORDER BY wrong DESC, last DESC LIMIT 12`)
    .all(userId);

  // What's known, what's mastered and which mistakes Quick rounds should bring back.
  const history = db
    .prepare(`
      SELECT a.question_id AS id, a.correct, a.created_at AS at, a.round_id AS roundId, a.category AS topic, r.category AS roundKind
      FROM answers a JOIN rounds r ON r.id = a.round_id
      WHERE a.user_id = ? ORDER BY a.id`)
    .all(userId);
  const playsInQuick = (id) => QUESTION_BY_ID.has(id) && inQuickRounds(QUESTION_BY_ID.get(id));
  const { knownIds, masteredIds, dueMistakes } = reviewState(history, (at) => Math.floor((at + shift) / dayMs), playsInQuick);
  const topicOf = new Map(history.map((a) => [a.id, a.topic]));
  const masteredByTopic = {};
  for (const id of masteredIds) masteredByTopic[topicOf.get(id)] = (masteredByTopic[topicOf.get(id)] || 0) + 1;

  // The round just played, so the next one doesn't open with the same questions.
  const lastRoundIds = db
    .prepare('SELECT question_id AS id FROM answers WHERE round_id = (SELECT MAX(id) FROM rounds WHERE user_id = ?)')
    .all(userId)
    .map((r) => r.id);

  const seenIds = db.prepare('SELECT DISTINCT question_id AS id FROM answers WHERE user_id = ?').all(userId).map((r) => r.id);

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
    byCategory: byCategory.map((c) => ({ ...c, mastered: masteredByTopic[c.category] || 0 })),
    recent,
    days,
    seenIds,
    knownIds,
    masteredIds,
    dueMistakes,
    lastRoundIds,
    xp: getProfile(db, userId)?.xp ?? 0,
  };
}

// ── Profiles ───────────────────────────────────────────────────

// Friend codes leave out letters and digits that look alike (0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const randomCode = (n) => Array.from(randomBytes(n), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

/** The player's profile, made on first use: their first name, an avatar picked from their id, a friend code, and the XP of any rounds they played before profiles existed. */
export function ensureProfile(db, user) {
  const have = getProfile(db, user.id);
  if (have) return have;
  const name = cleanName(String(user.name || '').split(' ')[0]) || 'Player';
  for (let tries = 0; ; tries++) {
    try {
      db.prepare('INSERT INTO profiles (user_id, name, avatar, friend_code, updated_at, xp) VALUES (?, ?, ?, ?, ?, ?)')
        .run(user.id, name, randomAvatar(user.id), randomCode(6), Date.now(), earnedXp(db, user.id));
      return getProfile(db, user.id);
    } catch (err) {
      if (tries > 5 || !/UNIQUE/.test(err.message)) throw err; // a clashing friend code: try another
    }
  }
}

export function getProfile(db, userId) {
  const row = db.prepare('SELECT user_id, name, avatar, country, hidden, friend_code, tz_offset, xp FROM profiles WHERE user_id = ?').get(userId);
  return row ? toProfile(row) : null;
}

const toProfile = (r) => ({
  id: r.user_id, name: r.name, avatar: r.avatar, country: r.country ?? null, hidden: r.hidden === 1, code: r.friend_code, tz: r.tz_offset, xp: r.xp, level: levelFor(r.xp),
});

/** How a player shows up to someone else: hidden players are anonymous on public boards. */
export const shownProfile = (p, { anonymous = false } = {}) =>
  anonymous && p.hidden ? { id: null, name: null, avatar: null, country: null, level: null, hidden: true } : { id: p.id, name: p.name, avatar: p.avatar, country: p.country, level: p.level };

/** A display name: printable characters only, spaces tidied, at most PROFILE.nameMax long. */
function cleanName(s) {
  return String(s ?? '').replace(/[\p{C}<>]/gu, '').replace(/\s+/g, ' ').trim().slice(0, PROFILE.nameMax);
}

/** Saves the player's name, avatar, country and board visibility. Throws a 400 error for invalid values. */
export function saveProfile(db, userId, changes) {
  const p = getProfile(db, userId);
  if ('name' in changes) {
    const name = cleanName(changes.name);
    if (!name) throw badRequest('Enter a name.');
    p.name = name;
  }
  if ('avatar' in changes) {
    if (!parseAvatar(changes.avatar)) throw badRequest('Unknown avatar.');
    const need = avatarLevel(changes.avatar);
    if (changes.avatar !== p.avatar && need > p.level) throw badRequest(`That avatar unlocks at level ${need}.`);
    p.avatar = changes.avatar;
  }
  if ('country' in changes) {
    if (changes.country !== null && !isCountry(changes.country)) throw badRequest('Unknown country.');
    p.country = changes.country;
  }
  if ('hidden' in changes) {
    if (typeof changes.hidden !== 'boolean') throw badRequest('hidden must be true or false.');
    p.hidden = changes.hidden;
  }
  db.prepare('UPDATE profiles SET name = ?, avatar = ?, country = ?, hidden = ?, updated_at = ? WHERE user_id = ?')
    .run(p.name, p.avatar, p.country, p.hidden ? 1 : 0, Date.now(), userId);
  return p;
}

/** Remembers the player's time zone, for their streak as friends see it and for morning reminders. */
export function setTimezone(db, userId, tzOffsetMin) {
  db.prepare('UPDATE profiles SET tz_offset = ? WHERE user_id = ? AND tz_offset != ?').run(tzOffsetMin, userId, tzOffsetMin);
}

export function profileByCode(db, code) {
  const row = db.prepare('SELECT user_id, name, avatar, country, hidden, friend_code, tz_offset, xp FROM profiles WHERE friend_code = ?').get(String(code || '').toUpperCase());
  return row ? toProfile(row) : null;
}

// ── Friends ────────────────────────────────────────────────────

/** Makes two players friends (both ways). Returns false if they already were. */
export function addFriend(db, a, b) {
  if (a === b) throw badRequest("That's your own code.");
  const count = db.prepare('SELECT COUNT(*) AS n FROM friends WHERE user_id = ?').get(a).n;
  if (count >= PROFILE.maxFriends) throw badRequest(`You can have up to ${PROFILE.maxFriends} friends.`);
  const now = Date.now();
  const ins = db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)');
  const added = ins.run(a, b, now).changes > 0;
  ins.run(b, a, now);
  return added;
}

export function removeFriend(db, a, b) {
  db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(a, b, b, a);
}

export const areFriends = (db, a, b) => !!db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?').get(a, b);

export const friendIds = (db, userId) => db.prepare('SELECT friend_id AS id FROM friends WHERE user_id = ?').all(userId).map((r) => r.id);

/** The player's friends with their day streak (in their own time zone) and today's Daily score. */
export function listFriends(db, userId, day) {
  const rows = db.prepare(`
    SELECT p.user_id, p.name, p.avatar, p.country, p.hidden, p.friend_code, p.tz_offset, p.xp,
           d.score AS daily_score, d.finished_at AS daily_done,
           (SELECT MAX(created_at) FROM rounds r WHERE r.user_id = p.user_id) AS last_played
    FROM friends f
    JOIN profiles p ON p.user_id = f.friend_id
    LEFT JOIN daily_results d ON d.user_id = f.friend_id AND d.day = ?
    WHERE f.user_id = ?
  `).all(day, userId);
  return rows.map((r) => ({
    ...shownProfile(toProfile(r)),
    streak: dayStreaks(db, r.user_id, r.tz_offset).current,
    daily: r.daily_done ? r.daily_score : null,
    lastPlayed: r.last_played ?? null,
  })).sort((a, b) => b.streak - a.streak || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
}

// ── Daily Challenge ────────────────────────────────────────────

/** The Daily for `day` ({ day, number, questionIds }), picking its questions with `pick(recentIds)` the first time. */
export function getDaily(db, day, number, pick) {
  let row = db.prepare('SELECT day, number, question_ids FROM daily_challenges WHERE day = ?').get(day);
  if (!row) {
    // Questions used in the last 90 Dailies aren't picked again.
    const recent = new Set(db.prepare('SELECT question_ids FROM daily_challenges ORDER BY day DESC LIMIT 90').all()
      .flatMap((r) => JSON.parse(r.question_ids)));
    db.prepare('INSERT OR IGNORE INTO daily_challenges (day, number, question_ids, created_at) VALUES (?, ?, ?, ?)')
      .run(day, number, JSON.stringify(pick(recent)), Date.now());
    row = db.prepare('SELECT day, number, question_ids FROM daily_challenges WHERE day = ?').get(day);
  }
  return { day: row.day, number: row.number, questionIds: JSON.parse(row.question_ids) };
}

const toDailyResult = (r) => r && ({
  started: r.started_at, finished: r.finished_at ?? null, score: r.score, correct: r.correct, total: r.total, ms: r.ms, roundId: r.round_id,
});

export function dailyResult(db, day, userId) {
  return toDailyResult(db.prepare('SELECT * FROM daily_results WHERE day = ? AND user_id = ?').get(day, userId));
}

/** Starts the player's one try. Returns false if they had already started (or finished) it. */
export function startDaily(db, day, userId) {
  return db.prepare('INSERT OR IGNORE INTO daily_results (day, user_id, started_at) VALUES (?, ?, ?)').run(day, userId, Date.now()).changes > 0;
}

/** Scores the player's try. Returns false if it was already scored. */
export function finishDaily(db, day, userId, { roundId, score, correct, total, ms }) {
  return db.prepare(`
    UPDATE daily_results SET round_id = ?, score = ?, correct = ?, total = ?, ms = ?, finished_at = ?
    WHERE day = ? AND user_id = ? AND finished_at IS NULL
  `).run(roundId, score, correct, total, ms, Date.now(), day, userId).changes > 0;
}

/**
 * The Daily's boards: the top `limit` players, the viewer's own place and neighbours, and all their friends.
 * Ranked by score, then by less time taken, then by who finished first.
 */
export function dailyBoard(db, day, viewerId, limit = 50) {
  const ranked = db.prepare(`
    SELECT ROW_NUMBER() OVER (ORDER BY d.score DESC, d.ms ASC, d.finished_at ASC) AS rank,
           d.user_id, d.score, d.correct, d.total, d.ms,
           p.name, p.avatar, p.country, p.hidden, p.friend_code, p.tz_offset, p.xp
    FROM daily_results d JOIN profiles p ON p.user_id = d.user_id
    WHERE d.day = ? AND d.finished_at IS NOT NULL
  `).all(day);
  const friends = new Set(friendIds(db, viewerId));
  const entry = (r) => {
    const known = r.user_id === viewerId || friends.has(r.user_id);
    return { rank: r.rank, score: r.score, correct: r.correct, total: r.total, ms: r.ms, me: r.user_id === viewerId,
      ...shownProfile(toProfile(r), { anonymous: !known }) };
  };
  const mine = ranked.findIndex((r) => r.user_id === viewerId);
  return {
    players: ranked.length,
    top: ranked.slice(0, limit).map(entry),
    me: mine >= 0 ? entry(ranked[mine]) : null,
    around: mine >= 0 ? ranked.slice(Math.max(0, mine - BOARD.around), mine + BOARD.around + 1).map(entry) : [],
    friends: ranked.filter((r) => r.user_id === viewerId || friends.has(r.user_id)).map(entry),
  };
}

/** Friends who already finished `day`'s Daily with a lower score than `score`. */
export function friendsBeaten(db, day, userId, score) {
  return db.prepare(`
    SELECT d.user_id, d.score FROM daily_results d JOIN friends f ON f.friend_id = d.user_id AND f.user_id = ?
    WHERE d.day = ? AND d.finished_at IS NOT NULL AND d.score < ?
  `).all(userId, day, score);
}

// ── Duels ──────────────────────────────────────────────────────

export function createDuel(db, { id, challengerId, invitedId = null, category, questionIds, rematchOf = null }) {
  db.prepare('INSERT INTO duels (id, challenger_id, invited_id, category, question_ids, rematch_of, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, challengerId, invitedId, category, JSON.stringify(questionIds), rematchOf, Date.now());
  return getDuel(db, id);
}

export function getDuel(db, id) {
  const r = db.prepare('SELECT * FROM duels WHERE id = ?').get(id);
  if (!r) return null;
  const side = (k) => ({ score: r[`${k}_score`], correct: r[`${k}_correct`], ms: r[`${k}_ms`], roundId: r[`${k}_round`] });
  return {
    id: r.id, category: r.category, questionIds: JSON.parse(r.question_ids), rematchOf: r.rematch_of,
    challengerId: r.challenger_id, opponentId: r.opponent_id, invitedId: r.invited_id,
    challenger: side('challenger'), opponent: side('opponent'),
    createdAt: r.created_at, acceptedAt: r.accepted_at, finishedAt: r.finished_at, resultUnseenBy: r.result_unseen_by,
  };
}

/** Makes `userId` the duel's second player if the seat is free. Returns the duel, or null if someone else has it. */
export function claimDuel(db, id, userId) {
  db.prepare(`
    UPDATE duels SET opponent_id = ?, accepted_at = ?
    WHERE id = ? AND opponent_id IS NULL AND opponent_score IS NULL AND challenger_id != ? AND (invited_id IS NULL OR invited_id = ?)
  `).run(userId, Date.now(), id, userId, userId);
  const duel = getDuel(db, id);
  return duel?.opponentId === userId ? duel : null;
}

/** Records one side's result. The duel is finished once both have played, and the first to play has a result to see. */
export function finishDuelSide(db, id, side, { roundId, score, correct, ms }) {
  const col = side === 'challenger' ? 'challenger' : 'opponent';
  const other = side === 'challenger' ? 'opponent' : 'challenger';
  const changed = db.prepare(`
    UPDATE duels SET ${col}_score = ?, ${col}_correct = ?, ${col}_ms = ?, ${col}_round = ? WHERE id = ? AND ${col}_score IS NULL
  `).run(score, correct, ms, roundId, id).changes > 0;
  db.prepare(`
    UPDATE duels SET finished_at = ?, result_unseen_by = ${other}_id
    WHERE id = ? AND finished_at IS NULL AND challenger_score IS NOT NULL AND opponent_score IS NOT NULL
  `).run(Date.now(), id);
  return changed;
}

/** The player has now seen this duel's result. */
export function markDuelResultSeen(db, id, userId) {
  db.prepare('UPDATE duels SET result_unseen_by = NULL WHERE id = ? AND result_unseen_by = ?').run(id, userId);
}

/** Questions the player met in their last few rounds. */
export function recentQuestionIds(db, userId, rounds = 30) {
  return db.prepare('SELECT DISTINCT question_id AS id FROM answers WHERE round_id IN (SELECT id FROM rounds WHERE user_id = ? ORDER BY id DESC LIMIT ?)')
    .all(userId, rounds).map((r) => r.id);
}

/** The player's duels, newest first: ones they're in, and ones sent to them that nobody has taken. */
export function listDuels(db, userId, limit = 30) {
  return db.prepare(`
    SELECT id FROM duels
    WHERE challenger_id = ? OR opponent_id = ? OR (invited_id = ? AND opponent_id IS NULL)
    ORDER BY COALESCE(finished_at, accepted_at, created_at) DESC LIMIT ?
  `).all(userId, userId, userId, limit).map((r) => getDuel(db, r.id));
}

/** Duels the player started that aren't finished yet. */
export const openDuelCount = (db, userId) =>
  db.prepare('SELECT COUNT(*) AS n FROM duels WHERE challenger_id = ? AND finished_at IS NULL').get(userId).n;

/** A round's answers in the order they were given: { id, choice, correct, ms }. */
export function roundAnswers(db, roundId) {
  if (!roundId) return [];
  return db.prepare('SELECT question_id AS id, choice, correct, ms FROM answers WHERE round_id = ? ORDER BY id').all(roundId)
    .map((a) => ({ ...a, correct: a.correct === 1 }));
}

// ── Rounds played on the server (see server/play.js) ───────────

const toPlay = (r) => r && ({
  id: r.id, userId: r.user_id, kind: r.kind, ref: r.ref, side: r.side, questionIds: JSON.parse(r.question_ids), idx: r.idx,
  openedAt: r.opened_at, answers: JSON.parse(r.answers), startedAt: r.started_at, updatedAt: r.updated_at, finishedAt: r.finished_at,
  content: r.content ? JSON.parse(r.content) : null,
});

export const getPlay = (db, id) => toPlay(db.prepare('SELECT * FROM plays WHERE id = ?').get(id)) ?? null;

export const findPlay = (db, kind, ref, userId) =>
  toPlay(db.prepare('SELECT * FROM plays WHERE kind = ? AND ref = ? AND user_id = ?').get(kind, ref, userId)) ?? null;

export function createPlay(db, { kind, ref, side, userId, questionIds, content = null }) {
  const id = randomUUID();
  const now = Date.now();
  db.prepare('INSERT INTO plays (id, user_id, kind, ref, side, question_ids, content, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, kind, ref, side, JSON.stringify(questionIds), content ? JSON.stringify(content) : null, now, now);
  return getPlay(db, id);
}

/** Starts the question's clock. Only the first opening counts. */
export function openPlayQuestion(db, id, idx, now) {
  db.prepare('UPDATE plays SET opened_at = ?, updated_at = ? WHERE id = ? AND idx = ? AND opened_at IS NULL AND finished_at IS NULL').run(now, now, id, idx);
}

export function recordPlayAnswer(db, id, idx, answers, now) {
  db.prepare('UPDATE plays SET idx = ?, opened_at = NULL, answers = ?, updated_at = ? WHERE id = ? AND finished_at IS NULL')
    .run(idx, JSON.stringify(answers), now, id);
}

/** Marks a round as ended. False if it already had: what ended it has counted it. */
export function closePlay(db, id) {
  return db.prepare('UPDATE plays SET finished_at = ? WHERE id = ? AND finished_at IS NULL').run(Date.now(), id).changes > 0;
}

export const stalePlays = (db, before) =>
  db.prepare('SELECT * FROM plays WHERE finished_at IS NULL AND updated_at < ?').all(before).map(toPlay);

/** Finished rounds are only useful while their result is fresh; the Daily and duel tables keep what matters. */
export function purgeOldPlays(db) {
  db.prepare('DELETE FROM plays WHERE finished_at IS NOT NULL AND finished_at < ?').run(Date.now() - 3 * DAY_MS);
}

// ── Leveling stages ────────────────────────────────────────────
// Written on the admin dashboard. Every try is played on the server (see server/play.js), with
// `ref` "<stage id>:<random>" because a player can try a stage as often as they like.

const notFound = (message) => Object.assign(new Error(message), { status: 404 });

/** Text for a stage: control characters and extra spaces go, and it must fit. `label` starts with a small letter. */
function stageText(value, max, label) {
  if (typeof value !== 'string') throw badRequest(`Enter ${label}.`);
  const text = value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw badRequest(`Enter ${label}.`);
  if (text.length > max) throw badRequest(`${label[0].toUpperCase()}${label.slice(1)} can be at most ${max} characters.`);
  return text;
}

/** A picture address the browser is allowed to load, or null for no picture. */
function stagePicture(value) {
  if (value === null || value === undefined || value === '') return null;
  const address = typeof value === 'string' ? value.trim() : null;
  if (address === '') return null;
  const refuse = () => badRequest(`The picture must be an https address on ${STAGE_PICTURE_HOSTS.join(' or ')}, or a file under /img/ or /signs/.`);
  if (address === null || address.length > STAGE.pictureMax) throw refuse();
  if (address.startsWith('/')) {
    if (!/^\/(img|signs)\/[\w.%/-]+$/.test(address) || address.includes('..') || address.includes('//')) throw refuse();
    return address;
  }
  let url;
  try {
    url = new URL(address);
  } catch {
    throw refuse();
  }
  if (url.protocol !== 'https:' || !STAGE_PICTURE_HOSTS.includes(url.hostname) || url.username || url.password || url.port) throw refuse();
  return url.href;
}

/** A question as typed on the dashboard, checked. Throws a 400 error that says what to fix. */
function cleanStageQuestion(input) {
  const prompt = stageText(input.prompt, STAGE.promptMax, 'the question');
  const answer = stageText(input.answer, STAGE.optionMax, 'the right answer');
  if (!Array.isArray(input.wrong) || input.wrong.length !== STAGE.wrongOptions) throw badRequest(`Enter ${STAGE.wrongOptions} wrong answers.`);
  const wrong = input.wrong.map((w, i) => stageText(w, STAGE.optionMax, `wrong answer ${i + 1}`));
  const seen = new Set();
  for (const option of [answer, ...wrong]) {
    const key = option.toLocaleLowerCase();
    if (seen.has(key)) throw badRequest(`"${option}" is there twice. All ${STAGE.wrongOptions + 1} answers must be different.`);
    seen.add(key);
  }
  return { prompt, answer, wrong, picture: stagePicture(input.picture) };
}

const toAdminStage = (r) => ({ id: r.id, title: r.title, published: r.published === 1, count: r.count });
const toStageQuestion = (r) => ({ id: r.id, prompt: r.prompt, answer: r.answer, wrong: JSON.parse(r.wrong), picture: r.picture ?? null });
const STAGE_FIELDS = 's.id, s.title, s.published, (SELECT COUNT(*) FROM stage_questions q WHERE q.stage_id = s.id) AS count';

export const listStages = (db) =>
  db.prepare(`SELECT ${STAGE_FIELDS} FROM stages s ORDER BY s.position, s.id`).all().map(toAdminStage);

const stageQuestions = (db, stageId) =>
  db.prepare('SELECT * FROM stage_questions WHERE stage_id = ? ORDER BY position, id').all(stageId).map(toStageQuestion);

function stageRow(db, id) {
  const row = db.prepare(`SELECT ${STAGE_FIELDS} FROM stages s WHERE s.id = ?`).get(id);
  if (!row) throw notFound('That stage no longer exists.');
  return toAdminStage(row);
}

/** A stage with its questions, answers included. For the dashboard only. */
export const stageForAdmin = (db, id) => ({ stage: stageRow(db, id), questions: stageQuestions(db, id) });

/** A new stage goes last and starts as a draft. */
export function createStage(db, { title }) {
  const clean = stageText(title, STAGE.titleMax, 'a name for the stage');
  const now = Date.now();
  const { next } = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM stages').get();
  const { lastInsertRowid: id } = db.prepare('INSERT INTO stages (title, position, created_at, updated_at) VALUES (?, ?, ?, ?)').run(clean, next, now, now);
  return stageRow(db, Number(id));
}

/** Renames a stage or changes whether players see it. A published stage always has enough questions. */
export function updateStage(db, id, changes) {
  const stage = stageRow(db, id);
  const title = 'title' in changes ? stageText(changes.title, STAGE.titleMax, 'a name for the stage') : stage.title;
  let published = stage.published;
  if ('published' in changes) {
    if (typeof changes.published !== 'boolean') throw badRequest('published must be true or false.');
    published = changes.published;
    if (published && stage.count < STAGE.minQuestions) throw badRequest(`A stage needs at least ${STAGE.minQuestions} questions before it can be published.`);
  }
  db.prepare('UPDATE stages SET title = ?, published = ?, updated_at = ? WHERE id = ?').run(title, published ? 1 : 0, Date.now(), id);
  return stageRow(db, id);
}

/** Swaps a row with its neighbour above or below. At either end it stays put. */
function moveRow(db, table, scope, id, direction) {
  if (direction !== 'up' && direction !== 'down') throw badRequest('direction must be up or down.');
  const list = db.prepare(`SELECT id, position FROM ${table} ${scope.where} ORDER BY position, id`).all(...scope.args);
  const at = list.findIndex((r) => r.id === id);
  const other = list[at + (direction === 'up' ? -1 : 1)];
  if (at < 0 || !other) return;
  const here = list[at];
  db.prepare(`UPDATE ${table} SET position = CASE id WHEN ? THEN ? WHEN ? THEN ? END WHERE id IN (?, ?)`)
    .run(here.id, other.position, other.id, here.position, here.id, other.id);
}

export function moveStage(db, id, direction) {
  stageRow(db, id);
  moveRow(db, 'stages', { where: '', args: [] }, id, direction);
  return listStages(db);
}

/** Deletes a stage, its questions and players' records of it. XP already earned stays, and rounds in progress finish from their own copy. */
export function deleteStage(db, id) {
  stageRow(db, id);
  db.prepare('DELETE FROM stages WHERE id = ?').run(id);
}

function stageQuestionRow(db, stageId, questionId) {
  const row = db.prepare('SELECT * FROM stage_questions WHERE id = ? AND stage_id = ?').get(questionId, stageId);
  if (!row) throw notFound('That question no longer exists.');
  return row;
}

export function addStageQuestion(db, stageId, input) {
  const stage = stageRow(db, stageId);
  if (stage.count >= STAGE.maxQuestions) throw badRequest(`A stage can have at most ${STAGE.maxQuestions} questions.`);
  const q = cleanStageQuestion(input);
  const now = Date.now();
  const { next } = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM stage_questions WHERE stage_id = ?').get(stageId);
  db.prepare('INSERT INTO stage_questions (stage_id, position, prompt, answer, wrong, picture, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(stageId, next, q.prompt, q.answer, JSON.stringify(q.wrong), q.picture, now, now);
  return stageForAdmin(db, stageId);
}

export function updateStageQuestion(db, stageId, questionId, input) {
  stageQuestionRow(db, stageId, questionId);
  const q = cleanStageQuestion(input);
  db.prepare('UPDATE stage_questions SET prompt = ?, answer = ?, wrong = ?, picture = ?, updated_at = ? WHERE id = ?')
    .run(q.prompt, q.answer, JSON.stringify(q.wrong), q.picture, Date.now(), questionId);
  return stageForAdmin(db, stageId);
}

export function moveStageQuestion(db, stageId, questionId, direction) {
  stageQuestionRow(db, stageId, questionId);
  moveRow(db, 'stage_questions', { where: 'WHERE stage_id = ?', args: [stageId] }, questionId, direction);
  return stageForAdmin(db, stageId);
}

export function deleteStageQuestion(db, stageId, questionId) {
  const stage = stageRow(db, stageId);
  stageQuestionRow(db, stageId, questionId);
  if (stage.published && stage.count <= STAGE.minQuestions) throw badRequest(`A published stage needs at least ${STAGE.minQuestions} questions. Unpublish it first.`);
  db.prepare('DELETE FROM stage_questions WHERE id = ?').run(questionId);
  return stageForAdmin(db, stageId);
}

/**
 * The published stages in order, as this player stands on them. A stage is open when the one
 * before it is cleared, and stays playable once cleared even if a new stage is put before it.
 */
export function stagePath(db, userId) {
  const rows = db.prepare(`
    SELECT s.id, s.title, (SELECT COUNT(*) FROM stage_questions q WHERE q.stage_id = s.id) AS count,
           r.attempts, r.best_correct, r.best_total, r.best_score, r.cleared_at,
           r.last_correct, r.last_total, r.last_score, r.last_xp, r.last_bonus, r.last_at
    FROM stages s LEFT JOIN stage_results r ON r.stage_id = s.id AND r.user_id = ?
    WHERE s.published = 1 ORDER BY s.position, s.id
  `).all(userId);
  let previousCleared = true;
  return rows.map((r) => {
    const cleared = r.cleared_at !== null;
    const status = cleared ? 'cleared' : previousCleared ? 'open' : 'locked';
    previousCleared = cleared;
    return {
      id: r.id,
      title: r.title,
      count: r.count,
      status,
      attempts: r.attempts ?? 0,
      best: r.last_at === null ? null : { correct: r.best_correct, total: r.best_total, score: r.best_score },
      last: r.last_at === null ? null : { correct: r.last_correct, total: r.last_total, score: r.last_score, xp: r.last_xp, bonus: r.last_bonus, cleared: stageCleared(r.last_correct, r.last_total), at: r.last_at },
    };
  });
}

/** A stage's questions in the shape server/play.js plays: { ids, content }, or null if it has none. */
export function stageRound(db, stageId) {
  const questions = stageQuestions(db, stageId);
  if (!questions.length) return null;
  const toQuestion = (q) => ({
    id: `stage:${q.id}`, cat: 'stage', prompt: q.prompt, answer: q.answer, wrong: q.wrong, seconds: STAGE.seconds, ownPrompt: true,
    visual: q.picture ? { type: 'wiki', src: q.picture, credit: false } : { type: 'text' },
  });
  const content = Object.fromEntries(questions.map(toQuestion).map((q) => [q.id, q]));
  return { ids: Object.keys(content), content };
}

/** The try this player has open on this stage, if any. */
export const openStagePlay = (db, stageId, userId) =>
  toPlay(db.prepare("SELECT * FROM plays WHERE kind = 'stage' AND user_id = ? AND ref LIKE ? AND finished_at IS NULL").get(userId, `${stageId}:%`)) ?? null;

/**
 * Saves a finished try in one transaction: the round, its XP and the player's record of the stage.
 * `total` counts every question of the try, including any skipped, so skipping can't make a stage
 * easier. The bonus goes to whichever try sets cleared_at, which only one can.
 * `played` is false when no question was answered: such a try earns nothing.
 */
export function finishStageTry(db, { userId, stageId, mode, graded, total, played }) {
  return inTransaction(db, () => {
    const correct = graded.filter((a) => a.correct).length;
    const cleared = played && stageCleared(correct, total);
    const exists = !!db.prepare('SELECT 1 FROM stages WHERE id = ?').get(stageId);
    let firstClear = false;
    if (exists) {
      db.prepare('INSERT OR IGNORE INTO stage_results (user_id, stage_id) VALUES (?, ?)').run(userId, stageId);
      if (cleared) firstClear = db.prepare('UPDATE stage_results SET cleared_at = ? WHERE user_id = ? AND stage_id = ? AND cleared_at IS NULL').run(Date.now(), userId, stageId).changes > 0;
    }
    const bonusXp = firstClear ? XP.stageClear : 0;
    const round = played ? insertRound(db, userId, { mode, category: 'stage', graded, complete: true, bonusXp }) : null;
    const score = round?.score ?? 0;
    if (exists) {
      db.prepare(`
        UPDATE stage_results SET attempts = attempts + 1, last_correct = ?, last_total = ?, last_score = ?, last_xp = ?, last_bonus = ?, last_at = ?,
          best_correct = CASE WHEN ? >= best_score THEN ? ELSE best_correct END,
          best_total = CASE WHEN ? >= best_score THEN ? ELSE best_total END,
          best_score = MAX(best_score, ?)
        WHERE user_id = ? AND stage_id = ?
      `).run(correct, total, score, (round?.xpGained ?? 0) - bonusXp, bonusXp, Date.now(), score, correct, score, total, score, userId, stageId);
    }
    return { round, correct, total, score, cleared, firstClear, bonusXp };
  });
}

// ── Push reminders ─────────────────────────────────────────────

export function savePushSubscription(db, userId, { endpoint, p256dh, auth }) {
  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
  `).run(endpoint, userId, p256dh, auth, Date.now());
}

export function deletePushSubscription(db, endpoint, userId = null) {
  if (userId) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, userId);
  else db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export const pushSubscriptions = (db, userId) =>
  db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);

/** Notes that a reminder went out. Returns false if it already had, so it isn't sent twice. */
export function markNotified(db, userId, kind, ref) {
  return db.prepare('INSERT OR IGNORE INTO notifications_sent (user_id, kind, ref, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, kind, ref, Date.now()).changes > 0;
}

/** Players who turned on reminders of `kind` ('daily' or 'friends') and have a browser to send them to. */
export function reminderTargets(db, kind) {
  const col = kind === 'daily' ? 'notify_daily' : 'notify_friends';
  return db.prepare(`
    SELECT s.user_id, s.language, p.tz_offset, p.name FROM settings s
    JOIN profiles p ON p.user_id = s.user_id
    WHERE s.${col} = 1 AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = s.user_id)
  `).all();
}

export function purgeOldNotifications(db) {
  db.prepare('DELETE FROM notifications_sent WHERE created_at < ?').run(Date.now() - 30 * DAY_MS);
}
