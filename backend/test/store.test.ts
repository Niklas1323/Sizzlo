import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, test } from 'node:test';
import { DEFAULT_RULES } from '../src/config.ts';
import { DEMO_USER_ID, seedDemoUser } from '../src/seed.ts';
import { openDatabase } from '../src/store/db.ts';
import { Repository } from '../src/store/repository.ts';

const dir = mkdtempSync(join(tmpdir(), 'sizzlo-db-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const columnsOf = (db: DatabaseSync, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe('database', () => {
  test('a database from the 20-level plan is rebuilt and seeded again', () => {
    const path = join(dir, 'old.db');
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, visibility TEXT, timezone TEXT NOT NULL, holiday_save_mode TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE holiday_saves (user_id TEXT NOT NULL, week_start TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO users VALUES ('demo-alex', 'Alex', 'private', 'Europe/Zurich', 'auto', '2026-08-24T17:30:00.000Z');
    `);
    old.close();

    const db = openDatabase(path);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    assert.equal(tables.includes('holiday_saves'), false);
    assert.ok(tables.includes('xp_awards') && tables.includes('skills_tried'));
    assert.deepEqual(['units', 'sound', 'vibration', 'visibility', 'holiday_save_mode'].map((c) => columnsOf(db, 'users').includes(c)), [true, false, true, false, false]);
    assert.ok(tables.includes('feedback'));

    const repo = new Repository(db);
    seedDemoUser(repo, DEFAULT_RULES, new Date('2026-10-12T08:00:00Z'));
    assert.equal(repo.totalXp(DEMO_USER_ID), 810);
    db.close();

    // Opening it again keeps the data.
    const again = openDatabase(path);
    assert.equal(new Repository(again).totalXp(DEMO_USER_ID), 810);
    again.close();
  });

  test('a version 2 database keeps its data and loses the Sound setting', () => {
    const path = join(dir, 'v2.db');
    const v2 = openDatabase(path);
    const robin = new Repository(v2).createUser({ displayName: 'Robin', timezone: 'Europe/Zurich', createdAt: '2026-09-01T08:00:00.000Z' });
    new Repository(v2).completeLearn(robin.id, { level: 1, xp: 50, on: '2026-09-01', at: '2026-09-01T08:00:00.000Z' });
    v2.exec('DROP TABLE feedback; ALTER TABLE users ADD COLUMN sound INTEGER NOT NULL DEFAULT 1; PRAGMA user_version = 2;');
    v2.close();

    const db = openDatabase(path);
    assert.equal(columnsOf(db, 'users').includes('sound'), false);
    assert.ok(columnsOf(db, 'feedback').includes('forwarded_at'));
    const repo = new Repository(db);
    assert.equal(repo.totalXp(robin.id), 50);
    assert.equal(repo.getUser(robin.id)?.displayName, 'Robin');
    // Level 1 was the Pizza Twists Learn level; on the skills-first path that is Level 3.
    assert.deepEqual([...repo.getProgress(robin.id).keys()], [3]);
    db.close();
  });

  test('a version 3 database keeps its data on the skills-first path', () => {
    const path = join(dir, 'v3.db');
    const v3 = openDatabase(path);
    const old = new Repository(v3);
    const at = (day: string) => `${day}T17:30:00.000Z`;
    // The 24-level plan: 1–3 Pizza Twists, 4–6 the Omelette, 10–12 Smash Burger Tacos.
    const robin = old.createUser({ displayName: 'Robin', timezone: 'Europe/Zurich', createdAt: at('2026-09-01') });
    old.completeLearn(robin.id, { level: 1, xp: 50, on: '2026-09-01', at: at('2026-09-01') });
    old.recordAttempt(robin.id, { level: 2, stars: 3, xpAwarded: 100, bestStars: 3, playedOn: '2026-09-02', at: at('2026-09-02') });
    old.recordCook(robin.id, { recipeId: 'pizza-twists', level: 3, cookedOn: '2026-09-03', note: 'crispy', skillIds: ['safe-cuts', 'cut-and-twist'], xp: 100, createdAt: at('2026-09-03') });
    old.completeLearn(robin.id, { level: 4, xp: 50, on: '2026-09-04', at: at('2026-09-04') });
    old.completeLearn(robin.id, { level: 10, xp: 50, on: '2026-09-05', at: at('2026-09-05') });
    old.createUser({ id: DEMO_USER_ID, displayName: 'Alex', timezone: 'Europe/Zurich', isDemo: true, createdAt: at('2026-08-24') });
    old.completeLearn(DEMO_USER_ID, { level: 1, xp: 50, on: '2026-09-01', at: at('2026-09-01') });
    // Back to the version 3 layout: no refresh tables, no 'refresh' XP.
    v3.exec(`
      DROP TABLE skill_reviews;
      DROP TABLE cook_skills;
      DROP INDEX xp_awards_user_day;
      ALTER TABLE xp_awards RENAME TO xp_awards_v4;
      CREATE TABLE xp_awards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        level INTEGER NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('learn', 'practice', 'cook')),
        xp INTEGER NOT NULL CHECK (xp > 0),
        earned_on TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO xp_awards SELECT * FROM xp_awards_v4;
      DROP TABLE xp_awards_v4;
      CREATE INDEX xp_awards_user_day ON xp_awards(user_id, earned_on);
      PRAGMA user_version = 3;
    `);
    v3.close();

    const db = openDatabase(path);
    const repo = new Repository(db);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 4);
    assert.ok(columnsOf(db, 'skill_reviews').includes('reviewed_on'));
    // Same users, XP (the tacos Learn included), cooks and tried skills.
    assert.equal(repo.getUser(robin.id)?.displayName, 'Robin');
    assert.equal(repo.totalXp(robin.id), 350);
    assert.deepEqual(repo.listCooked(robin.id).map((c) => [c.recipeId, c.cookedOn, c.note]), [['pizza-twists', '2026-09-03', 'crispy']]);
    assert.deepEqual([...repo.triedSkills(robin.id).keys()].sort(), ['cut-and-twist', 'safe-cuts']);
    // Progress moved to the same recipe's levels; Smash Burger Tacos is gone.
    const progress = repo.getProgress(robin.id);
    assert.deepEqual([...progress.keys()].sort((a, b) => a - b), [3, 4, 5, 6]);
    assert.deepEqual([progress.get(4)?.bestStars, progress.get(5)?.cookedAt, progress.get(6)?.learnCompletedAt], [3, at('2026-09-03'), at('2026-09-04')]);
    assert.deepEqual(repo.practiceResults(robin.id).map((p) => [p.level, p.stars]), [[4, 3]]);
    assert.deepEqual((db.prepare('SELECT level FROM xp_awards WHERE user_id = ? ORDER BY id').all(robin.id) as { level: number }[]).map((r) => r.level), [3, 4, 5, 6, 0]);
    // The cook's skills come from skills_tried, so it counts as a review.
    assert.deepEqual(repo.cookedSkills(robin.id).map((c) => c.skillId).sort(), ['cut-and-twist', 'safe-cuts']);
    // xp_awards now takes refresh XP and still has its index.
    repo.recordRefresh(robin.id, { skillId: 'pastry-strips', score: 3, level: 4, xp: 10, on: '2026-10-12', at: at('2026-10-12') });
    assert.equal(repo.totalXp(robin.id), 360);
    const index = db.prepare("SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = 'xp_awards_user_day'").get() as { tbl_name: string };
    assert.equal(index.tbl_name, 'xp_awards');
    // The demo is seeded again with the new path.
    assert.equal(repo.getUser(DEMO_USER_ID), undefined);
    seedDemoUser(repo, DEFAULT_RULES, new Date('2026-10-12T08:00:00Z'));
    assert.equal(repo.totalXp(DEMO_USER_ID), 810);
    db.close();

    const again = openDatabase(path);
    assert.equal(new Repository(again).totalXp(robin.id), 360);
    again.close();
  });
});
