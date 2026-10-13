import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AvatarPreset, Language, Units } from '../config.ts';
import type { LocalDate } from '../domain/dates.ts';
import type { LevelProgress } from '../domain/progress.ts';
import { transaction } from './db.ts';

export interface User {
  id: string;
  displayName: string;
  language: Language;
  timezone: string;
  units: Units;
  sound: boolean;
  vibration: boolean;
  isDemo: boolean;
  avatarFile: string | null;
  avatarType: string | null;
  avatarPreset: AvatarPreset | null;
  createdAt: string;
}

export interface CookedEntry {
  id: string;
  recipeId: string;
  cookedOn: LocalDate;
  note: string | null;
  photoFile: string | null;
  photoType: string | null;
  photoAddedAt: string | null;
  createdAt: string;
}

export interface UserPatch {
  displayName?: string;
  language?: Language;
  timezone?: string;
  units?: Units;
  sound?: boolean;
  vibration?: boolean;
  avatarPreset?: AvatarPreset | null;
}

type Row = Record<string, unknown>;

const toUser = (r: Row): User => ({
  id: String(r.id),
  displayName: String(r.display_name),
  language: r.language as Language,
  timezone: String(r.timezone),
  units: r.units as Units,
  sound: Number(r.sound) === 1,
  vibration: Number(r.vibration) === 1,
  isDemo: Number(r.is_demo) === 1,
  avatarFile: r.avatar_file == null ? null : String(r.avatar_file),
  avatarType: r.avatar_type == null ? null : String(r.avatar_type),
  avatarPreset: r.avatar_preset == null ? null : (String(r.avatar_preset) as AvatarPreset),
  createdAt: String(r.created_at),
});

const optional = (v: unknown) => (v == null ? null : String(v));

const toCooked = (r: Row): CookedEntry => ({
  id: String(r.id),
  recipeId: String(r.recipe_id),
  cookedOn: String(r.cooked_on),
  note: optional(r.note),
  photoFile: optional(r.photo_file),
  photoType: optional(r.photo_type),
  photoAddedAt: optional(r.photo_added_at),
  createdAt: String(r.created_at),
});

const toProgress = (r: Row): LevelProgress => ({
  level: Number(r.level),
  learnCompletedAt: optional(r.learn_completed_at),
  bestStars: Number(r.best_stars),
  attempts: Number(r.attempts),
  cookedAt: optional(r.cooked_at),
  skippedAt: optional(r.skipped_at),
});

/** Why XP was awarded: the kind of level that earned it. */
export type XpReason = 'learn' | 'practice' | 'cook';

export class Repository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  createUser(input: { id?: string; displayName: string; timezone: string; isDemo?: boolean; createdAt: string }): User {
    const id = input.id ?? randomUUID();
    this.db
      .prepare('INSERT INTO users (id, display_name, timezone, is_demo, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, input.displayName, input.timezone, input.isDemo ? 1 : 0, input.createdAt);
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
      timezone: 'timezone',
      units: 'units',
      sound: 'sound',
      vibration: 'vibration',
      avatarPreset: 'avatar_preset',
    };
    // SQLite has no booleans: sound and vibration are stored as 1 or 0.
    const value = (v: UserPatch[keyof UserPatch]) => (typeof v === 'boolean' ? (v ? 1 : 0) : (v ?? null));
    const keys = (Object.keys(patch) as (keyof UserPatch)[]).filter((k) => patch[k] !== undefined);
    if (keys.length > 0) {
      const sql = `UPDATE users SET ${keys.map((k) => `${columns[k]} = ?`).join(', ')} WHERE id = ?`;
      this.db.prepare(sql).run(...keys.map((k) => value(patch[k])), id);
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

  /** Marks a Learn level done; the first time only, also books its XP. */
  completeLearn(userId: string, l: { level: number; xp: number; on: LocalDate; at: string }): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO level_progress (user_id, level, learn_completed_at) VALUES (?, ?, ?)
           ON CONFLICT (user_id, level) DO UPDATE SET learn_completed_at = COALESCE(learn_completed_at, excluded.learn_completed_at)`,
        )
        .run(userId, l.level, l.at);
      this.awardXp(userId, { level: l.level, reason: 'learn', xp: l.xp, on: l.on, at: l.at });
    });
  }

  recordAttempt(userId: string, a: { level: number; stars: number; xpAwarded: number; bestStars: number; playedOn: LocalDate; at: string }): void {
    transaction(this.db, () => {
      this.db
        .prepare('INSERT INTO level_attempts (user_id, level, stars, played_on, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(userId, a.level, a.stars, a.playedOn, a.at);
      this.db
        .prepare(
          `INSERT INTO level_progress (user_id, level, best_stars, attempts) VALUES (?, ?, ?, 1)
           ON CONFLICT (user_id, level) DO UPDATE SET best_stars = MAX(best_stars, excluded.best_stars), attempts = attempts + 1`,
        )
        .run(userId, a.level, a.bestStars);
      this.awardXp(userId, { level: a.level, reason: 'practice', xp: a.xpAwarded, on: a.playedOn, at: a.at });
    });
  }

  /** Skips a Cook level. The first skip is kept; cooking later still completes the level. */
  skipLevel(userId: string, level: number, at: string): void {
    this.db
      .prepare(
        `INSERT INTO level_progress (user_id, level, skipped_at) VALUES (?, ?, ?)
         ON CONFLICT (user_id, level) DO UPDATE SET skipped_at = COALESCE(skipped_at, excluded.skipped_at)`,
      )
      .run(userId, level, at);
  }

  /** Every skill a real cook marked as tried: skill id → when it was first tried. */
  triedSkills(userId: string): Map<string, string> {
    const rows = this.db.prepare('SELECT skill_id, tried_at FROM skills_tried WHERE user_id = ?').all(userId) as Row[];
    return new Map(rows.map((r) => [String(r.skill_id), String(r.tried_at)]));
  }

  private awardXp(userId: string, x: { level: number; reason: XpReason; xp: number; on: LocalDate; at: string }): void {
    if (x.xp <= 0) return;
    this.db
      .prepare('INSERT INTO xp_awards (user_id, level, reason, xp, earned_on, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, x.level, x.reason, x.xp, x.on, x.at);
  }

  totalXp(userId: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(xp), 0) AS xp FROM xp_awards WHERE user_id = ?').get(userId) as Row;
    return Number(row.xp);
  }

  xpByDay(userId: string, from: LocalDate, to: LocalDate): { day: LocalDate; xp: number }[] {
    const rows = this.db
      .prepare('SELECT earned_on AS day, SUM(xp) AS xp FROM xp_awards WHERE user_id = ? AND earned_on BETWEEN ? AND ? GROUP BY earned_on')
      .all(userId, from, to) as Row[];
    return rows.map((r) => ({ day: String(r.day), xp: Number(r.xp) }));
  }

  setAvatar(userId: string, file: string | null, type: string | null): void {
    this.db.prepare('UPDATE users SET avatar_file = ?, avatar_type = ? WHERE id = ?').run(file, type, userId);
  }

  /**
   * A real cook: the Recipe Book entry, the recipe's Cook level done, the skills
   * it marked as tried and, for the recipe's first cook, its XP.
   */
  recordCook(
    userId: string,
    c: { recipeId: string; level: number; cookedOn: LocalDate; note: string | null; skillIds: readonly string[]; xp: number; createdAt: string },
  ): CookedEntry {
    const id = randomUUID();
    transaction(this.db, () => {
      this.db
        .prepare('INSERT INTO cooked_recipes (id, user_id, recipe_id, cooked_on, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, userId, c.recipeId, c.cookedOn, c.note, c.createdAt);
      this.db
        .prepare(
          `INSERT INTO level_progress (user_id, level, cooked_at) VALUES (?, ?, ?)
           ON CONFLICT (user_id, level) DO UPDATE SET cooked_at = COALESCE(cooked_at, excluded.cooked_at)`,
        )
        .run(userId, c.level, c.createdAt);
      const tried = this.db.prepare('INSERT OR IGNORE INTO skills_tried (user_id, skill_id, tried_at) VALUES (?, ?, ?)');
      for (const skillId of c.skillIds) tried.run(userId, skillId, c.createdAt);
      this.awardXp(userId, { level: c.level, reason: 'cook', xp: c.xp, on: c.cookedOn, at: c.createdAt });
    });
    return this.getCooked(userId, id) as CookedEntry;
  }

  getCooked(userId: string, id: string): CookedEntry | undefined {
    const row = this.db.prepare('SELECT * FROM cooked_recipes WHERE user_id = ? AND id = ?').get(userId, id) as Row | undefined;
    return row ? toCooked(row) : undefined;
  }

  listCooked(userId: string, limit = 1000): CookedEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM cooked_recipes WHERE user_id = ? ORDER BY cooked_on DESC, created_at DESC LIMIT ?')
      .all(userId, limit) as Row[];
    return rows.map(toCooked);
  }

  deleteCooked(userId: string, id: string): boolean {
    const result = this.db.prepare('DELETE FROM cooked_recipes WHERE user_id = ? AND id = ?').run(userId, id);
    return Number(result.changes) > 0;
  }

  setCookedPhoto(userId: string, id: string, photo: { file: string; type: string; at: string } | null): void {
    this.db
      .prepare('UPDATE cooked_recipes SET photo_file = ?, photo_type = ?, photo_added_at = ? WHERE user_id = ? AND id = ?')
      .run(photo?.file ?? null, photo?.type ?? null, photo?.at ?? null, userId, id);
  }

  /** Dates and recipes of everything the user really cooked; the streak and achievements read this. */
  cookedDays(userId: string): { cookedOn: LocalDate; recipeId: string }[] {
    const rows = this.db.prepare('SELECT cooked_on, recipe_id FROM cooked_recipes WHERE user_id = ?').all(userId) as Row[];
    return rows.map((r) => ({ cookedOn: String(r.cooked_on), recipeId: String(r.recipe_id) }));
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
