import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  visibility TEXT NOT NULL DEFAULT 'private',
  timezone TEXT NOT NULL,
  holiday_save_mode TEXT NOT NULL CHECK (holiday_save_mode IN ('auto', 'manual')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_equipment (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  PRIMARY KEY (user_id, item)
);

-- One row per user and level: Learn finished, best stars, Skill Passport evidence.
CREATE TABLE IF NOT EXISTS level_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  learn_completed_at TEXT,
  best_stars INTEGER NOT NULL DEFAULT 0 CHECK (best_stars BETWEEN 0 AND 3),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_completed_at TEXT,
  tried_for_real_at TEXT,
  PRIMARY KEY (user_id, level)
);

-- Every Practice result, kept for history and the XP chart.
CREATE TABLE IF NOT EXISTS level_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 3),
  xp_awarded INTEGER NOT NULL,
  played_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS level_attempts_user_day ON level_attempts(user_id, played_on);

-- Real cooking or baking projects. They feed the weekly streak. Private by default.
CREATE TABLE IF NOT EXISTS cook_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('cook', 'bake')),
  title TEXT NOT NULL,
  note TEXT,
  recipe_id TEXT,
  cooked_on TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cook_logs_user_day ON cook_logs(user_id, cooked_on);

-- Holiday Saves the user picked themselves (manual mode). Auto mode needs no rows.
CREATE TABLE IF NOT EXISTS holiday_saves (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, week_start)
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);
`;

/** Opens (and migrates) the database. Pass ":memory:" for tests. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
