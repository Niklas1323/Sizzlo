import { DEFAULT_EQUIPMENT } from '../config.ts';
import type { AvatarPreset, Equipment, Language, Rules, Units } from '../config.ts';
import { evaluateAchievements } from '../domain/achievements.ts';
import { getChapter, getLevel, getRecipe, LEVEL_COUNT, PLANNED_RECIPES, RECIPES, recipeOfLevel } from '../domain/curriculum.ts';
import type { Level, LevelKind, Recipe } from '../domain/curriculum.ts';
import { addDays, daysBetween, mondayOf, todayIn, weekLabel } from '../domain/dates.ts';
import type { LocalDate } from '../domain/dates.ts';
import { bestStarsOf, chapterSummaries, currentLevel, isDone, isPassed, isUnlocked, levelStatus, pathLevels, recipeUnlocked, skillPassport, totals } from '../domain/progress.ts';
import { computeStreak, recentWeeks, streakProjectDates } from '../domain/streak.ts';
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

const KIND_NAMES: Record<LevelKind, string> = { learn: 'Learn', practice: 'Practice', cook: 'Cook' };

/** The short form of a level that responses point to, e.g. the next level after a skip. */
const levelRef = (l: Level) => ({ level: l.level, kind: l.kind, title: l.title, recipeId: l.recipeId });

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
    const user = this.repo.createUser({ displayName, timezone: timezone ?? this.rules.defaultTimezone, createdAt: this.stamp() });
    this.repo.setEquipment(user.id, DEFAULT_EQUIPMENT);
    return user;
  }

  // ── Streak, stats, achievements ────────────────────────────────────────────

  streak(user: User) {
    const today = this.today(user);
    return {
      today,
      result: computeStreak({
        today,
        projectDates: streakProjectDates(this.repo.cookedDays(user.id)),
        savesPerYear: this.rules.holidaySavesPerYear,
      }),
    };
  }

  private achievementContext(user: User) {
    return {
      progress: this.repo.getProgress(user.id),
      skillsTried: this.repo.triedSkills(user.id).size,
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
        ? { ...levelRef(next), recipe: next.recipe, skills: next.skills, chapter: { chapter: next.chapter, title: getChapter(next.chapter)?.title ?? '' } }
        : null,
      chapters: chapterSummaries(progress),
      streak: this.streakView(user, 8),
      skillPassport: skillPassport(progress, this.repo.triedSkills(user.id)).summary,
      achievements: { earned: ach.earned, total: ach.total, latest },
    };
  }

  skillPassport(user: User) {
    return skillPassport(this.repo.getProgress(user.id), this.repo.triedSkills(user.id));
  }

  /** All levels in order with the user's status, for the level map. */
  path(user: User) {
    const progress = this.repo.getProgress(user.id);
    return { currentLevel: currentLevel(progress)?.level ?? null, chapters: chapterSummaries(progress), levels: pathLevels(progress) };
  }

  // ── Settings and profile picture ───────────────────────────────────────────

  settings(user: User) {
    return {
      displayName: user.displayName,
      avatarUrl: user.avatarFile ? '/api/me/avatar' : null,
      avatarPreset: user.avatarPreset,
      language: user.language,
      timezone: user.timezone,
      units: user.units,
      sound: user.sound,
      vibration: user.vibration,
      equipment: this.repo.getEquipment(user.id),
    };
  }

  updateSettings(
    user: User,
    patch: { displayName?: string; language?: Language; timezone?: string; units?: Units; sound?: boolean; vibration?: boolean; avatarPreset?: AvatarPreset | null; equipment?: Equipment[] },
  ) {
    const { equipment, ...fields } = patch;
    // One profile picture at a time: picking a preset replaces an uploaded photo.
    if (fields.avatarPreset && user.avatarFile) {
      this.media.remove(user.avatarFile);
      this.repo.setAvatar(user.id, null, null);
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

  // ── Levels: Learn, Practice, Cook ──────────────────────────────────────────

  completeLearn(user: User, level: number) {
    this.requirePlayable(user, level, 'learn');
    const xpAwarded = isDone(this.repo.getProgress(user.id), level) ? 0 : this.rules.xpForLearn;
    this.repo.completeLearn(user.id, { level, xp: xpAwarded, on: this.today(user), at: this.stamp() });
    return { level, understood: true, xpAwarded, totalXp: this.repo.totalXp(user.id), newAchievements: this.syncAchievements(user) };
  }

  recordAttempt(user: User, level: number, stars: StarResult) {
    this.requirePlayable(user, level, 'practice');
    const previousBest = bestStarsOf(this.repo.getProgress(user.id), level);
    const score = scoreAttempt(previousBest, stars, this.rules);
    this.repo.recordAttempt(user.id, { level, stars, xpAwarded: score.xpAwarded, bestStars: score.bestStars, playedOn: this.today(user), at: this.stamp() });
    const recipe = recipeOfLevel(level) as Recipe;
    return {
      level,
      stars,
      ...score,
      totalXp: this.repo.totalXp(user.id),
      // Practice opens the recipe's Cook level: the app can offer Cook for Real right away, until it was cooked.
      recipeReady: isDone(this.repo.getProgress(user.id), recipe.levels.cook) ? null : { id: recipe.id, name: recipe.name, cookLevel: recipe.levels.cook },
      newAchievements: this.syncAchievements(user),
    };
  }

  /** Cook levels are optional: skipping one passes it and opens the next level. */
  skipLevel(user: User, level: number) {
    this.requirePlayable(user, level, 'cook');
    // Skipping a level that was already cooked changes nothing.
    if (!isDone(this.repo.getProgress(user.id), level)) this.repo.skipLevel(user.id, level, this.stamp());
    const next = getLevel(level + 1);
    return {
      level,
      status: levelStatus(this.repo.getProgress(user.id), level),
      nextLevel: next ? levelRef(next) : null,
      newAchievements: this.syncAchievements(user),
    };
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
        levels: { from: r.levels.learn, to: r.levels.cook, done: Object.values(r.levels).filter((n) => isPassed(progress, n)).length, total: 3 },
        /** The Cook level: "skipped" still lets the user cook the recipe any time. */
        cookLevel: { level: r.levels.cook, status: levelStatus(progress, r.levels.cook) },
        skills: r.skills,
        kind: r.kind,
        access: r.access,
        recipeStatus: r.recipeStatus,
        status: mine.length > 0 ? ('cooked' as const) : unlocked ? ('ready' as const) : ('locked' as const),
        timesCooked: mine.length,
        /** Cooking it now keeps the streak going: only a recipe's first cook counts. */
        countsForStreak: mine.length === 0,
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

  /**
   * Cook for Real. Completes the recipe's Cook level (also after a skip), earns
   * the first-cook XP once per recipe and marks its skills as tried: the ones in
   * `skills` (the stamps the user picked), or both when none are sent.
   */
  cookRecipe(user: User, recipeId: string, input: { cookedOn?: LocalDate; note?: string; skills?: string[] }) {
    const recipe = this.requireRecipe(recipeId);
    const progress = this.repo.getProgress(user.id);
    if (!recipeUnlocked(progress, recipe)) {
      throw new ServiceError(409, 'recipe_locked', `Finish Levels ${recipe.levels.learn}–${recipe.levels.practice} to cook ${recipe.name} for real.`);
    }
    const own = recipe.skills.map((s) => s.id);
    const stamped = input.skills ? [...new Set(input.skills)] : own;
    if (stamped.some((id) => !own.includes(id))) {
      throw new ServiceError(422, 'skill_not_in_recipe', `${recipe.name} uses these skills: ${own.join(', ')}.`);
    }
    const today = this.today(user);
    const cookedOn = input.cookedOn ?? today;
    if (cookedOn > today) throw new ServiceError(422, 'future_date', 'A cook cannot be recorded for a future day.');
    if (daysBetween(cookedOn, today) > this.rules.cookLogBackdateDays) {
      throw new ServiceError(422, 'too_old', `A cook can be recorded up to ${this.rules.cookLogBackdateDays} days back.`);
    }
    const earlier = this.repo.cookedDays(user.id).some((d) => d.recipeId === recipe.id && d.cookedOn <= cookedOn);
    const xpAwarded = isDone(progress, recipe.levels.cook) ? 0 : this.rules.xpForFirstCook;
    const entry = this.repo.recordCook(user.id, {
      recipeId: recipe.id,
      level: recipe.levels.cook,
      cookedOn,
      note: input.note ?? null,
      skillIds: stamped,
      xp: xpAwarded,
      createdAt: this.stamp(),
    });
    return {
      entry: this.entryView(entry),
      /** False when the recipe was cooked before: logged, but no streak credit. */
      countsForStreak: !earlier,
      photoUploadUrl: photoUrl(entry.id),
      cookLevel: { level: recipe.levels.cook, status: 'done' as const },
      xpAwarded,
      totalXp: this.repo.totalXp(user.id),
      skillsTried: stamped,
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

  private requireLevel(level: number): Level {
    const found = Number.isInteger(level) ? getLevel(level) : undefined;
    if (!found) throw new ServiceError(404, 'unknown_level', `Levels go from 1 to ${LEVEL_COUNT}.`);
    return found;
  }

  /** The level exists, is of the kind this action needs and is unlocked. */
  private requirePlayable(user: User, level: number, kind: LevelKind) {
    const found = this.requireLevel(level);
    if (found.kind !== kind) {
      throw new ServiceError(400, 'wrong_level_kind', `Level ${level} is a ${KIND_NAMES[found.kind]} level, not a ${KIND_NAMES[kind]} level.`);
    }
    if (!isUnlocked(this.repo.getProgress(user.id), level)) {
      throw new ServiceError(409, 'level_locked', `Finish Level ${level - 1} first.`);
    }
  }
}

/** Short, encouraging line for the streak card. Never shaming. */
export function streakMessage(current: number, thisWeek: 'done' | 'open'): string {
  if (current === 0) return thisWeek === 'done' ? 'Week 1 done. Your streak has started!' : 'Cook a new Sizzlo recipe this week to start a streak.';
  if (thisWeek === 'done') return `${current} weeks in a row. This week is covered.`;
  return `Cook a new recipe this week to make it ${current + 1}.`;
}
