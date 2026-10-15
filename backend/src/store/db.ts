import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getRecipe } from '../domain/curriculum.ts';

/** Raise when the layout changes in a way older data can't follow. */
const SCHEMA_VERSION = 4;

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
-- first real cook, a passed skill refresh (level: the drill's level). Feeds the
-- XP total and the XP chart.
CREATE TABLE IF NOT EXISTS xp_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('learn', 'practice', 'cook', 'refresh')),
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

-- The skills each real cook marked as tried. Every cook counts as a review of
-- them for the skill refresh, not only the first one.
CREATE TABLE IF NOT EXISTS cook_skills (
  cook_id TEXT NOT NULL REFERENCES cooked_recipes(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  PRIMARY KEY (cook_id, skill_id)
);

-- Skills a real cook marked as tried (Skill Passport). The first time is kept.
CREATE TABLE IF NOT EXISTS skills_tried (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  tried_at TEXT NOT NULL,
  PRIMARY KEY (user_id, skill_id)
);

-- Skill refresh drills (2 minutes, score 0–3). See domain/refresh.ts.
CREATE TABLE IF NOT EXISTS skill_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 3),
  reviewed_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS skill_reviews_user_skill ON skill_reviews(user_id, skill_id, reviewed_on);

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
 * they are rebuilt empty and the demo is seeded again. Version 2 also loses the
 * Sound setting. Versions 2 and 3 keep their data on the way to the skills-first
 * path (see toVersion4).
 */
function migrate(db: DatabaseSync): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version >= SCHEMA_VERSION) return;
  if (version < 2) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const { name } of tables) db.exec(`DROP TABLE "${name}"`);
    return;
  }
  transaction(db, () => {
    if (version === 2) db.exec('ALTER TABLE users DROP COLUMN sound');
    toVersion4(db);
  });
}

/** Versions 2 and 3 numbered 8 recipes × 3 levels (Learn, Practice, Cook) in this order. */
const V3_RECIPES = ['pizza-twists', 'egg-master-omelette', 'fluffy-pancakes', 'smash-burger-tacos', 'blueberry-vanilla-muffins', 'mac-and-cheese', 'rainbow-crunch-bowl', 'crispy-wrap'];

/**
 * The skills-first path. xp_awards learns the 'refresh' reason: SQLite can't
 * change a CHECK, so the table is rebuilt and its rows copied over. Progress
 * moves to the same recipe's levels on the new path; Smash Burger Tacos is gone,
 * its XP stays (on level 0). Cooks get their skills from skills_tried (only the
 * first cook of a skill is known). Demo users are removed so the new demo is
 * seeded; they only exist to show the designs.
 */
function toVersion4(db: DatabaseSync): void {
  db.exec('DROP INDEX IF EXISTS xp_awards_user_day; ALTER TABLE xp_awards RENAME TO xp_awards_v3;');
  db.exec(SCHEMA);
  db.exec(`
    INSERT INTO xp_awards (id, user_id, level, reason, xp, earned_on, created_at)
      SELECT id, user_id, level, reason, xp, earned_on, created_at FROM xp_awards_v3;
    DROP TABLE xp_awards_v3;
  `);

  const demo = 'SELECT id FROM users WHERE is_demo = 1';
  for (const table of ['user_equipment', 'level_progress', 'level_attempts', 'xp_awards', 'cooked_recipes', 'skills_tried', 'achievements']) {
    db.exec(`DELETE FROM ${table} WHERE user_id IN (${demo})`);
  }
  db.exec(`UPDATE feedback SET user_id = NULL WHERE user_id IN (${demo}); DELETE FROM users WHERE is_demo = 1;`);

  const moves = V3_RECIPES.flatMap((id, i) => {
    const levels = getRecipe(id)?.levels;
    return [levels?.learn, levels?.practice, levels?.cook].map((to, k) => `WHEN ${3 * i + k + 1} THEN ${to ?? 0}`);
  });
  const moved = `(CASE level ${moves.join(' ')} ELSE 0 END)`;
  db.exec(`DELETE FROM level_progress WHERE ${moved} = 0; DELETE FROM level_attempts WHERE ${moved} = 0;`);
  // Through negative numbers, so no row lands on a level another row still has to leave.
  for (const table of ['level_progress', 'level_attempts', 'xp_awards']) {
    db.exec(`UPDATE ${table} SET level = -${moved}; UPDATE ${table} SET level = -level;`);
  }

  db.exec(`
    INSERT OR IGNORE INTO cook_skills (cook_id, skill_id)
      SELECT c.id, t.skill_id FROM skills_tried t JOIN cooked_recipes c ON c.user_id = t.user_id AND c.created_at = t.tried_at;
  `);
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
