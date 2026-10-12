import type { AvatarPreset, HolidaySaveMode, Language, Rules, Visibility } from '../config.ts';
import { evaluateAchievements } from '../domain/achievements.ts';
import { getChapter, getLevel, getRecipe, LEVEL_COUNT, PLANNED_RECIPES, RECIPES } from '../domain/curriculum.ts';
import type { Recipe } from '../domain/curriculum.ts';
import { addDays, daysBetween, isoWeek, mondayOf, todayIn, weekLabel } from '../domain/dates.ts';
import type { LocalDate } from '../domain/dates.ts';
import { chapterSummaries, currentLevel, isCompleted, isUnlocked, recipeUnlocked, skillPassport, totals } from '../domain/progress.ts';
import { computeStreak, recentWeeks } from '../domain/streak.ts';
import { scoreAttempt } from '../domain/xp.ts';
import type { StarResult } from '../domain/xp.ts';
import type { ImageType, MediaStore } from '../store/media.ts';
import type { CookedEntry, Repository, User } from '../store/repository.ts';

export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface Image {
  type: ImageType;
  data: Buffer;
}

const photoUrl = (entryId: string) => `/api/me/cooked/${entryId}/photo`;

export class ProfileService {
  private readonly repo: Repository;
  private readonly media: MediaStore;
  private readonly rules: Rules;
  private readonly clock: Clock;

  constructor(repo: Repository, media: MediaStore, rules: Rules, clock: Clock = systemClock) {
    this.repo = repo;
    this.media = media;
    this.rules = rules;
    this.clock = clock;
  }

  private stamp(): string {
    return this.clock.now().toISOString();
  }

  today(user: User): LocalDate {
    return todayIn(user.timezone, this.clock.now());
  }

  requireUser(userId: string): User {
    const user = this.repo.getUser(userId);
    if (!user) throw new ServiceError(401, 'unknown_user', 'No user with this id.');
    return user;
  }

  createUser(displayName: string, timezone?: string): User {
    return this.repo.createUser({
      displayName,
      timezone: timezone ?? this.rules.defaultTimezone,
      holidaySaveMode: this.rules.defaultHolidaySaveMode,
      createdAt: this.stamp(),
    });
  }

  // ── Streak, stats, achievements ────────────────────────────────────────────

  streak(user: User) {
    const today = this.today(user);
    return {
      today,
      result: computeStreak({
        today,
        projectDates: this.repo.cookedDays(user.id).map((d) => d.cookedOn),
        manualSaveWeeks: this.repo.holidaySaveWeeks(user.id),
        mode: user.holidaySaveMode,
        savesPerYear: this.rules.holidaySavesPerYear,
      }),
    };
  }

  private achievementContext(user: User) {
    return {
      progress: this.repo.getProgress(user.id),
      projects: this.repo.cookedDays(user.id).map((d) => ({ kind: getRecipe(d.recipeId)?.kind ?? ('cook' as const) })),
      bestStreak: this.streak(user).result.best,
    };
  }

  /** Re-evaluates achievements and stores the ones met for the first time. Returns those new ones. */
  syncAchievements(user: User) {
    const before = this.repo.unlockedAchievements(user.id);
    const fresh = evaluateAchievements(this.achievementContext(user), before).filter((a) => a.earned && !before.has(a.id));
    if (fresh.length === 0) return [];
    const at = this.stamp();
    this.repo.unlockAchievements(user.id, fresh.map((a) => a.id), at);
    return fresh.map((a) => ({ ...a, unlockedAt: at }));
  }

  achievements(user: User) {
    this.syncAchievements(user);
    const states = evaluateAchievements(this.achievementContext(user), this.repo.unlockedAchievements(user.id));
    return { earned: states.filter((a) => a.earned).length, total: states.length, achievements: states };
  }

  streakView(user: User, weeks: number) {
    const { today, result } = this.streak(user);
    return {
      current: result.current,
      best: result.best,
      thisWeek: result.thisWeek,
      atRisk: result.atRisk,
      message: streakMessage(result.current, result.thisWeek.status),
      holidaySaves: result.holidaySaves,
      weeks: recentWeeks(result, today, weeks),
    };
  }

  /** XP per ISO week for the last `weeks` weeks, oldest first. */
  xpHistory(user: User, weeks: number) {
    const today = this.today(user);
    const thisMonday = mondayOf(today);
    const from = addDays(thisMonday, -7 * (weeks - 1));
    const perWeek = new Map<LocalDate, number>();
    for (const { day, xp } of this.repo.xpByDay(user.id, from, today)) {
      const monday = mondayOf(day);
      perWeek.set(monday, (perWeek.get(monday) ?? 0) + xp);
    }
    const series = Array.from({ length: weeks }, (_, i) => {
      const weekStart = addDays(from, 7 * i);
      return { weekStart, label: weekLabel(weekStart), xp: perWeek.get(weekStart) ?? 0, current: weekStart === thisMonday };
    });
    const total = series.reduce((sum, w) => sum + w.xp, 0);
    return {
      weeks: series,
      total,
      averagePerWeek: Math.round(total / weeks),
      bestWeek: series.reduce((top, w) => (w.xp > top.xp ? w : top), series[0]),
    };
  }

  profile(user: User) {
    const progress = this.repo.getProgress(user.id);
    const t = totals(progress);
    const next = currentLevel(progress);
    const ach = this.achievements(user);
    const latest = ach.achievements
      .filter((a) => a.earned)
      .sort((a, b) => String(b.unlockedAt).localeCompare(String(a.unlockedAt)))
      .slice(0, 4);
    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        initial: user.displayName.trim().charAt(0).toUpperCase(),
        avatarUrl: user.avatarFile ? '/api/me/avatar' : null,
        avatarPreset: user.avatarPreset,
        language: user.language,
        visibility: user.visibility,
        memberSince: user.createdAt.slice(0, 10),
        isDemo: user.isDemo,
      },
      stats: {
        xp: this.repo.totalXp(user.id),
        stars: { earned: t.stars, max: t.maxStars },
        levels: { completed: t.completed, total: t.total },
        recipesCooked: new Set(this.repo.cookedDays(user.id).map((d) => d.recipeId)).size,
      },
      currentLevel: next
        ? { level: next.level, skill: next.skill, recipe: next.recipe, chapter: { chapter: next.chapter, title: getChapter(next.chapter)?.title ?? '' } }
        : null,
      chapters: chapterSummaries(progress),
      streak: this.streakView(user, 8),
      skillPassport: skillPassport(progress).summary,
      achievements: { earned: ach.earned, total: ach.total, latest },
    };
  }

  skillPassport(user: User) {
    return skillPassport(this.repo.getProgress(user.id));
  }

  // ── Settings and profile picture ───────────────────────────────────────────

  settings(user: User) {
    return {
      displayName: user.displayName,
      avatarUrl: user.avatarFile ? '/api/me/avatar' : null,
      avatarPreset: user.avatarPreset,
      language: user.language,
      visibility: user.visibility,
      timezone: user.timezone,
      holidaySaveMode: user.holidaySaveMode,
      equipment: this.repo.getEquipment(user.id),
    };
  }

  updateSettings(user: User, patch: { displayName?: string; language?: Language; visibility?: Visibility; timezone?: string; holidaySaveMode?: HolidaySaveMode; avatarPreset?: AvatarPreset | null; equipment?: string[] }) {
    const { equipment, ...fields } = patch;
    // One profile picture at a time: picking a preset replaces an uploaded photo.
    if (fields.avatarPreset && user.avatarFile) {
      this.media.remove(user.avatarFile);
      this.repo.setAvatar(user.id, null, null);
    }
    if (fields.holidaySaveMode === 'manual' && user.holidaySaveMode === 'auto') {
      // Keep the saves auto mode already spent, so switching modes never rewrites past weeks.
      for (const week of this.streak(user).result.weeks) {
        if (week.status === 'saved') this.repo.addHolidaySave(user.id, week.weekStart, this.stamp());
      }
    }
    const updated = this.repo.updateUser(user.id, fields);
    if (equipment) this.repo.setEquipment(user.id, equipment);
    return this.settings(updated);
  }

  setAvatar(user: User, image: Image) {
    if (user.avatarFile) this.media.remove(user.avatarFile);
    const file = this.media.save(`avatars`, user.id, image.type, image.data);
    this.repo.setAvatar(user.id, file, image.type);
    if (user.avatarPreset) this.repo.updateUser(user.id, { avatarPreset: null });
    return { avatarUrl: '/api/me/avatar' };
  }

  avatar(user: User): Image {
    const data = user.avatarFile ? this.media.read(user.avatarFile) : null;
    if (!data || !user.avatarType) throw new ServiceError(404, 'no_avatar', 'No profile picture yet.');
    return { type: user.avatarType as ImageType, data };
  }

  removeAvatar(user: User) {
    if (user.avatarFile) this.media.remove(user.avatarFile);
    this.repo.setAvatar(user.id, null, null);
    return { avatarUrl: null };
  }

  // ── Levels and Skill Passport ──────────────────────────────────────────────

  completeLearn(user: User, level: number) {
    this.requireUnlockedLevel(user, level);
    this.repo.markLearnCompleted(user.id, level, this.stamp());
    return { level, understood: true };
  }

  recordAttempt(user: User, level: number, stars: StarResult) {
    this.requireUnlockedLevel(user, level);
    const previousBest = this.repo.getProgress(user.id).get(level)?.bestStars ?? 0;
    const score = scoreAttempt(previousBest, stars, this.rules);
    this.repo.recordAttempt(user.id, { level, stars, xpAwarded: score.xpAwarded, bestStars: score.bestStars, playedOn: this.today(user), at: this.stamp() });
    const progress = this.repo.getProgress(user.id);
    const recipe = RECIPES.find((r) => r.levels.includes(level));
    return {
      level,
      stars,
      ...score,
      totalXp: this.repo.totalXp(user.id),
      // Set when this result finished a recipe's levels: the app can offer Cook for Real right away.
      recipeReady: recipe && recipe.levels[recipe.levels.length - 1] === level && recipeUnlocked(progress, recipe) ? { id: recipe.id, name: recipe.name } : null,
      newAchievements: this.syncAchievements(user),
    };
  }

  setTriedForReal(user: User, level: number, tried: boolean) {
    this.requireLevel(level);
    if (tried && !isCompleted(this.repo.getProgress(user.id), level)) {
      throw new ServiceError(409, 'not_practiced', 'Finish the Practice for this level before marking it as tried for real.');
    }
    this.repo.setTriedForReal(user.id, level, tried ? this.stamp() : null);
    return { level, triedForReal: tried, newAchievements: tried ? this.syncAchievements(user) : [] };
  }

  // ── Cook for Real and the Recipe Book ──────────────────────────────────────

  private entryView(entry: CookedEntry) {
    const recipe = getRecipe(entry.recipeId);
    return {
      id: entry.id,
      recipeId: entry.recipeId,
      recipeName: recipe?.name ?? entry.recipeId,
      kind: recipe?.kind ?? 'cook',
      cookedOn: entry.cookedOn,
      note: entry.note,
      photoUrl: entry.photoFile ? photoUrl(entry.id) : null,
      visibility: 'private' as const,
      createdAt: entry.createdAt,
    };
  }

  recipeBook(user: User) {
    const progress = this.repo.getProgress(user.id);
    const entries = this.repo.listCooked(user.id);
    const recipes = RECIPES.map((r) => {
      const mine = entries.filter((e) => e.recipeId === r.id);
      const withPhoto = mine.find((e) => e.photoFile);
      const unlocked = recipeUnlocked(progress, r);
      return {
        id: r.id,
        name: r.name,
        practice: r.practice,
        levels: { from: r.levels[0], to: r.levels[r.levels.length - 1], done: r.levels.filter((n) => isCompleted(progress, n)).length, total: r.levels.length },
        kind: r.kind,
        access: r.access,
        recipeStatus: r.recipeStatus,
        status: mine.length > 0 ? ('cooked' as const) : unlocked ? ('ready' as const) : ('locked' as const),
        timesCooked: mine.length,
        lastCookedOn: mine[0]?.cookedOn ?? null,
        /** Latest photo the user took of this dish. The app shows the illustration as a badge on it, or alone when null. */
        photoUrl: withPhoto ? photoUrl(withPhoto.id) : null,
        latestEntryId: mine[0]?.id ?? null,
      };
    });
    return { recipes, planned: PLANNED_RECIPES };
  }

  cookedEntries(user: User, limit: number) {
    return this.repo.listCooked(user.id, limit).map((e) => this.entryView(e));
  }

  cookRecipe(user: User, recipeId: string, input: { cookedOn?: LocalDate; note?: string }) {
    const recipe = this.requireRecipe(recipeId);
    if (!recipeUnlocked(this.repo.getProgress(user.id), recipe)) {
      const from = recipe.levels[0];
      const to = recipe.levels[recipe.levels.length - 1];
      throw new ServiceError(409, 'recipe_locked', `Finish ${recipe.practice} (Levels ${from}–${to}) to cook it for real.`);
    }
    const today = this.today(user);
    const cookedOn = input.cookedOn ?? today;
    if (cookedOn > today) throw new ServiceError(422, 'future_date', 'A cook cannot be recorded for a future day.');
    if (daysBetween(cookedOn, today) > this.rules.cookLogBackdateDays) {
      throw new ServiceError(422, 'too_old', `A cook can be recorded up to ${this.rules.cookLogBackdateDays} days back.`);
    }
    const entry = this.repo.addCooked(user.id, { recipeId: recipe.id, cookedOn, note: input.note ?? null, createdAt: this.stamp() });
    return {
      entry: this.entryView(entry),
      photoUploadUrl: photoUrl(entry.id),
      streak: this.streakView(user, 8),
      newAchievements: this.syncAchievements(user),
    };
  }

  deleteCooked(user: User, id: string) {
    const entry = this.requireEntry(user, id);
    if (entry.photoFile) this.media.remove(entry.photoFile);
    this.repo.deleteCooked(user.id, id);
  }

  setCookedPhoto(user: User, id: string, image: Image) {
    const entry = this.requireEntry(user, id);
    if (entry.photoFile) this.media.remove(entry.photoFile);
    const file = this.media.save(`photos/${user.id}`, entry.id, image.type, image.data);
    this.repo.setCookedPhoto(user.id, id, { file, type: image.type, at: this.stamp() });
    return this.entryView(this.requireEntry(user, id));
  }

  cookedPhoto(user: User, id: string): Image {
    const entry = this.requireEntry(user, id);
    const data = entry.photoFile ? this.media.read(entry.photoFile) : null;
    if (!data || !entry.photoType) throw new ServiceError(404, 'no_photo', 'No photo for this cook yet.');
    return { type: entry.photoType as ImageType, data };
  }

  removeCookedPhoto(user: User, id: string) {
    const entry = this.requireEntry(user, id);
    if (entry.photoFile) this.media.remove(entry.photoFile);
    this.repo.setCookedPhoto(user.id, id, null);
    return this.entryView(this.requireEntry(user, id));
  }

  // ── Holiday Saves ──────────────────────────────────────────────────────────

  addHolidaySave(user: User, weekStart: LocalDate) {
    if (user.holidaySaveMode !== 'manual') {
      throw new ServiceError(409, 'auto_mode', 'Holiday Saves are applied automatically. Switch holidaySaveMode to "manual" to pick weeks yourself.');
    }
    if (mondayOf(weekStart) !== weekStart) throw new ServiceError(422, 'not_monday', 'weekStart must be the Monday of the week.');
    const thisMonday = mondayOf(this.today(user));
    if (weekStart < addDays(thisMonday, -7)) throw new ServiceError(422, 'too_old', 'Holiday Saves can cover last week, this week or a later week.');
    const year = isoWeek(weekStart).year;
    const taken = this.repo.holidaySaveWeeks(user.id).filter((w) => isoWeek(w).year === year && w !== weekStart).length;
    if (taken >= this.rules.holidaySavesPerYear) {
      throw new ServiceError(409, 'no_saves_left', `All ${this.rules.holidaySavesPerYear} Holiday Saves for ${year} are used.`);
    }
    this.repo.addHolidaySave(user.id, weekStart, this.stamp());
    return this.streakView(user, 8);
  }

  removeHolidaySave(user: User, weekStart: LocalDate) {
    if (!this.repo.deleteHolidaySave(user.id, weekStart)) throw new ServiceError(404, 'not_found', 'No Holiday Save for this week.');
    return this.streakView(user, 8);
  }

  // ── Guards ─────────────────────────────────────────────────────────────────

  private requireRecipe(recipeId: string): Recipe {
    const recipe = getRecipe(recipeId);
    if (!recipe) throw new ServiceError(404, 'unknown_recipe', 'No recipe with this id.');
    return recipe;
  }

  private requireEntry(user: User, id: string): CookedEntry {
    const entry = this.repo.getCooked(user.id, id);
    if (!entry) throw new ServiceError(404, 'not_found', 'No cook with this id.');
    return entry;
  }

  private requireLevel(level: number) {
    if (!Number.isInteger(level) || level < 1 || level > LEVEL_COUNT || !getLevel(level)) {
      throw new ServiceError(404, 'unknown_level', `Levels go from 1 to ${LEVEL_COUNT}.`);
    }
  }

  private requireUnlockedLevel(user: User, level: number) {
    this.requireLevel(level);
    if (!isUnlocked(this.repo.getProgress(user.id), level)) {
      throw new ServiceError(409, 'level_locked', `Finish Level ${level - 1} first.`);
    }
  }
}

/** Short, encouraging line for the streak card. Never shaming. */
export function streakMessage(current: number, thisWeek: 'done' | 'saved' | 'open'): string {
  if (current === 0) return thisWeek === 'done' ? 'Week 1 done. Your streak has started!' : 'Cook a Sizzlo recipe this week to start a streak.';
  if (thisWeek === 'done') return `${current} weeks in a row. This week is covered.`;
  if (thisWeek === 'saved') return 'This week is covered by a Holiday Save.';
  return `Cook a recipe this week to make it ${current + 1}.`;
}
