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
    assert.deepEqual(['units', 'sound', 'vibration', 'visibility', 'holiday_save_mode'].map((c) => columnsOf(db, 'users').includes(c)), [true, true, true, false, false]);

    const repo = new Repository(db);
    seedDemoUser(repo, DEFAULT_RULES, new Date('2026-10-12T08:00:00Z'));
    assert.equal(repo.totalXp(DEMO_USER_ID), 525);
    db.close();

    // Opening it again keeps the data.
    const again = openDatabase(path);
    assert.equal(new Repository(again).totalXp(DEMO_USER_ID), 525);
    again.close();
  });
});
