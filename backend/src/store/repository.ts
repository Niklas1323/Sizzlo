import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { HolidaySaveMode, Language, Visibility } from '../config.ts';
import type { LocalDate } from '../domain/dates.ts';
import type { LevelProgress } from '../domain/progress.ts';
import { transaction } from './db.ts';

export interface User {
  id: string;
  displayName: string;
  language: Language;
  visibility: Visibility;
  timezone: string;
  holidaySaveMode: HolidaySaveMode;
  isDemo: boolean;
  createdAt: string;
}

export interface CookLog {
  id: string;
  kind: 'cook' | 'bake';
  title: string;
  note: string | null;
  recipeId: string | null;
  cookedOn: LocalDate;
  visibility: 'private';
  createdAt: string;
}

export interface UserPatch {
  displayName?: string;
  language?: Language;
  visibility?: Visibility;
  timezone?: string;
  holidaySaveMode?: HolidaySaveMode;
}

type Row = Record<string, unknown>;

const toUser = (r: Row): User => ({
  id: String(r.id),
  displayName: String(r.display_name),
  language: r.language as Language,
  visibility: r.visibility as Visibility,
  timezone: String(r.timezone),
  holidaySaveMode: r.holiday_save_mode as HolidaySaveMode,
  isDemo: Number(r.is_demo) === 1,
  createdAt: String(r.created_at),
});

const toCookLog = (r: Row): CookLog => ({
  id: String(r.id),
  kind: r.kind as 'cook' | 'bake',
  title: String(r.title),
  note: r.note == null ? null : String(r.note),
  recipeId: r.recipe_id == null ? null : String(r.recipe_id),
  cookedOn: String(r.cooked_on),
  visibility: 'private',
  createdAt: String(r.created_at),
});

const toProgress = (r: Row): LevelProgress => ({
  level: Number(r.level),
  learnCompletedAt: r.learn_completed_at == null ? null : String(r.learn_completed_at),
  bestStars: Number(r.best_stars),
  attempts: Number(r.attempts),
  firstCompletedAt: r.first_completed_at == null ? null : String(r.first_completed_at),
  triedForRealAt: r.tried_for_real_at == null ? null : String(r.tried_for_real_at),
});

export class Repository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  createUser(input: { id?: string; displayName: string; timezone: string; holidaySaveMode: HolidaySaveMode; isDemo?: boolean; createdAt: string }): User {
    const id = input.id ?? randomUUID();
    this.db
      .prepare('INSERT INTO users (id, display_name, timezone, holiday_save_mode, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, input.displayName, input.timezone, input.holidaySaveMode, input.isDemo ? 1 : 0, input.createdAt);
    return this.getUser(id) as User;
  }

  getUser(id: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    return row ? toUser(row) : undefined;
  }

  updateUser(id: string, patch: UserPatch): User {
    const columns: Record<keyof UserPatch, string> = {
      displayName: 'display_name',
      language: 'language',
      visibility: 'visibility',
      timezone: 'timezone',
      holidaySaveMode: 'holiday_save_mode',
    };
    const keys = (Object.keys(patch) as (keyof UserPatch)[]).filter((k) => patch[k] !== undefined);
    if (keys.length > 0) {
      const sql = `UPDATE users SET ${keys.map((k) => `${columns[k]} = ?`).join(', ')} WHERE id = ?`;
      this.db.prepare(sql).run(...keys.map((k) => patch[k] as string), id);
    }
    return this.getUser(id) as User;
  }

  getEquipment(userId: string): string[] {
    const rows = this.db.prepare('SELECT item FROM user_equipment WHERE user_id = ? ORDER BY item').all(userId) as Row[];
    return rows.map((r) => String(r.item));
  }

  setEquipment(userId: string, items: readonly string[]): void {
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM user_equipment WHERE user_id = ?').run(userId);
      const insert = this.db.prepare('INSERT INTO user_equipment (user_id, item) VALUES (?, ?)');
      for (const item of new Set(items)) insert.run(userId, item);
    });
  }

  getProgress(userId: string): Map<number, LevelProgress> {
    const rows = this.db.prepare('SELECT * FROM level_progress WHERE user_id = ?').all(userId) as Row[];
    return new Map(rows.map((r) => [Number(r.level), toProgress(r)]));
  }

  markLearnCompleted(userId: string, level: number, at: string): void {
    this.db
      .prepare(
        `INSERT INTO level_progress (user_id, level, learn_completed_at) VALUES (?, ?, ?)
         ON CONFLICT (user_id, level) DO UPDATE SET learn_completed_at = COALESCE(learn_completed_at, excluded.learn_completed_at)`,
      )
      .run(userId, level, at);
  }

  recordAttempt(userId: string, a: { level: number; stars: number; xpAwarded: number; bestStars: number; playedOn: LocalDate; at: string }): void {
    transaction(this.db, () => {
      this.db
        .prepare('INSERT INTO level_attempts (user_id, level, stars, xp_awarded, played_on, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(userId, a.level, a.stars, a.xpAwarded, a.playedOn, a.at);
      // Finishing Practice also means the Learn part was seen.
      this.db
        .prepare(
          `INSERT INTO level_progress (user_id, level, learn_completed_at, best_stars, attempts, first_completed_at)
           VALUES (?, ?, ?, ?, 1, ?)
           ON CONFLICT (user_id, level) DO UPDATE SET
             best_stars = MAX(best_stars, excluded.best_stars),
             attempts = attempts + 1,
             learn_completed_at = COALESCE(learn_completed_at, excluded.learn_completed_at),
             first_completed_at = COALESCE(first_completed_at, excluded.first_completed_at)`,
        )
        .run(userId, a.level, a.at, a.bestStars, a.at);
    });
  }

  setTriedForReal(userId: string, level: number, at: string | null): void {
    this.db.prepare('UPDATE level_progress SET tried_for_real_at = ? WHERE user_id = ? AND level = ?').run(at, userId, level);
  }

  totalXp(userId: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(xp_awarded), 0) AS xp FROM level_attempts WHERE user_id = ?').get(userId) as Row;
    return Number(row.xp);
  }

  xpByDay(userId: string, from: LocalDate, to: LocalDate): { day: LocalDate; xp: number }[] {
    const rows = this.db
      .prepare('SELECT played_on AS day, SUM(xp_awarded) AS xp FROM level_attempts WHERE user_id = ? AND played_on BETWEEN ? AND ? GROUP BY played_on')
      .all(userId, from, to) as Row[];
    return rows.map((r) => ({ day: String(r.day), xp: Number(r.xp) }));
  }

  addCookLog(userId: string, log: Omit<CookLog, 'id' | 'visibility'>): CookLog {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO cook_logs (id, user_id, kind, title, note, recipe_id, cooked_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, log.kind, log.title, log.note, log.recipeId, log.cookedOn, log.createdAt);
    return { ...log, id, visibility: 'private' };
  }

  deleteCookLog(userId: string, id: string): boolean {
    const result = this.db.prepare('DELETE FROM cook_logs WHERE user_id = ? AND id = ?').run(userId, id);
    return Number(result.changes) > 0;
  }

  listCookLogs(userId: string, limit: number): CookLog[] {
    const rows = this.db
      .prepare('SELECT * FROM cook_logs WHERE user_id = ? ORDER BY cooked_on DESC, created_at DESC LIMIT ?')
      .all(userId, limit) as Row[];
    return rows.map(toCookLog);
  }

  projects(userId: string): { cookedOn: LocalDate; kind: 'cook' | 'bake' }[] {
    const rows = this.db.prepare('SELECT cooked_on, kind FROM cook_logs WHERE user_id = ?').all(userId) as Row[];
    return rows.map((r) => ({ cookedOn: String(r.cooked_on), kind: r.kind as 'cook' | 'bake' }));
  }

  holidaySaveWeeks(userId: string): LocalDate[] {
    const rows = this.db.prepare('SELECT week_start FROM holiday_saves WHERE user_id = ? ORDER BY week_start').all(userId) as Row[];
    return rows.map((r) => String(r.week_start));
  }

  addHolidaySave(userId: string, weekStart: LocalDate, at: string): void {
    this.db.prepare('INSERT OR IGNORE INTO holiday_saves (user_id, week_start, created_at) VALUES (?, ?, ?)').run(userId, weekStart, at);
  }

  deleteHolidaySave(userId: string, weekStart: LocalDate): boolean {
    const result = this.db.prepare('DELETE FROM holiday_saves WHERE user_id = ? AND week_start = ?').run(userId, weekStart);
    return Number(result.changes) > 0;
  }

  unlockedAchievements(userId: string): Map<string, string> {
    const rows = this.db.prepare('SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ?').all(userId) as Row[];
    return new Map(rows.map((r) => [String(r.achievement_id), String(r.unlocked_at)]));
  }

  unlockAchievements(userId: string, ids: readonly string[], at: string): void {
    const insert = this.db.prepare('INSERT OR IGNORE INTO achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)');
    for (const id of ids) insert.run(userId, id, at);
  }
}
