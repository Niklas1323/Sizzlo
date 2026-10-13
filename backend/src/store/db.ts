import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Raise when the layout changes in a way older data can't follow. */
const SCHEMA_VERSION = 3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL,
  units TEXT NOT NULL DEFAULT 'metric' CHECK (units IN ('metric', 'us')),
  vibration INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  avatar_file TEXT,
  avatar_type TEXT,
  avatar_preset TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_equipment (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  PRIMARY KEY (user_id, item)
);

-- One row per user and level. Learn levels use learn_completed_at, Practice
-- levels best_stars and attempts, Cook levels cooked_at and skipped_at.
CREATE TABLE IF NOT EXISTS level_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  learn_completed_at TEXT,
  best_stars INTEGER NOT NULL DEFAULT 0 CHECK (best_stars BETWEEN 0 AND 3),
  attempts INTEGER NOT NULL DEFAULT 0,
  cooked_at TEXT,
  skipped_at TEXT,
  PRIMARY KEY (user_id, level)
);

-- Every Practice result, kept for history.
CREATE TABLE IF NOT EXISTS level_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 3),
  played_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Every XP award: a Learn level finished, a better Practice result, a recipe's
-- first real cook. Feeds the XP total and the XP chart.
CREATE TABLE IF NOT EXISTS xp_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('learn', 'practice', 'cook')),
  xp INTEGER NOT NULL CHECK (xp > 0),
  earned_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS xp_awards_user_day ON xp_awards(user_id, earned_on);

-- A Sizzlo recipe the user really cooked ("Cook for Real"). Feeds the weekly
-- streak and the Recipe Book. The photo is private and optional per entry.
CREATE TABLE IF NOT EXISTS cooked_recipes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id TEXT NOT NULL,
  cooked_on TEXT NOT NULL,
  note TEXT,
  photo_file TEXT,
  photo_type TEXT,
  photo_added_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cooked_recipes_user_day ON cooked_recipes(user_id, cooked_on);

-- Skills a real cook marked as tried (Skill Passport). The first time is kept.
CREATE TABLE IF NOT EXISTS skills_tried (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  tried_at TEXT NOT NULL,
  PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);

-- "Give feedback" from the app. Kept even when the user is deleted; forwarded_at
-- is set once the message reached the team's webhook (FEEDBACK_WEBHOOK_URL).
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  message TEXT NOT NULL,
  screen TEXT,
  app_version TEXT,
  language TEXT NOT NULL,
  created_at TEXT NOT NULL,
  forwarded_at TEXT
);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback(created_at);
`;

/** Opens (and migrates) the database. Pass ":memory:" for tests. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return db;
}

/**
 * Version 1 databases (before the three-level recipes) hold progress for another
 * level plan and settings that are gone. They only ever held development data, so
 * they are rebuilt empty and the demo is seeded again. Version 2 only loses the
 * Sound setting.
 */
function migrate(db: DatabaseSync): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version >= SCHEMA_VERSION) return;
  if (version === 2) {
    db.exec('ALTER TABLE users DROP COLUMN sound');
    return;
  }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  for (const { name } of tables) db.exec(`DROP TABLE "${name}"`);
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
