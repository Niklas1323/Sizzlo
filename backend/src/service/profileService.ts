import type { HolidaySaveMode, Language, Rules, Visibility } from '../config.ts';
import { evaluateAchievements } from '../domain/achievements.ts';
import { getChapter, getLevel, LEVEL_COUNT } from '../domain/curriculum.ts';
import { addDays, daysBetween, isoWeek, mondayOf, todayIn, weekLabel } from '../domain/dates.ts';
import type { LocalDate } from '../domain/dates.ts';
import { chapterSummaries, currentLevel, isUnlocked, skillPassport, totals } from '../domain/progress.ts';
import { computeStreak, recentWeeks } from '../domain/streak.ts';
import { scoreAttempt } from '../domain/xp.ts';
import type { StarResult } from '../domain/xp.ts';
import type { CookLog, Repository, User } from '../store/repository.ts';

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

export class ProfileService {
  private readonly repo: Repository;
  private readonly rules: Rules;
  private readonly clock: Clock;

  constructor(repo: Repository, rules: Rules, clock: Clock = systemClock) {
    this.repo = repo;
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

  streak(user: User) {
    const today = this.today(user);
    return {
      today,
      result: computeStreak({
        today,
        projectDates: this.repo.projects(user.id).map((p) => p.cookedOn),
        manualSaveWeeks: this.repo.holidaySaveWeeks(user.id),
        mode: user.holidaySaveMode,
        savesPerYear: this.rules.holidaySavesPerYear,
      }),
    };
  }

  /** Re-evaluates achievements and stores the ones met for the first time. Returns those new ones. */
  syncAchievements(user: User) {
    const before = this.repo.unlockedAchievements(user.id);
    const states = evaluateAchievements(
      { progress: this.repo.getProgress(user.id), projects: this.repo.projects(user.id), bestStreak: this.streak(user).result.best },
      before,
    );
    const fresh = states.filter((a) => a.earned && !before.has(a.id));
    if (fresh.length > 0) {
      const at = this.stamp();
      this.repo.unlockAchievements(user.id, fresh.map((a) => a.id), at);
      return fresh.map((a) => ({ ...a, unlockedAt: at }));
    }
    return [];
  }

  achievements(user: User) {
    this.syncAchievements(user);
    const states = evaluateAchievements(
      { progress: this.repo.getProgress(user.id), projects: this.repo.projects(user.id), bestStreak: this.streak(user).result.best },
      this.repo.unlockedAchievements(user.id),
    );
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
    const streak = this.streakView(user, 8);
    const passport = skillPassport(progress);
    const latest = ach.achievements
      .filter((a) => a.earned)
      .sort((a, b) => String(b.unlockedAt).localeCompare(String(a.unlockedAt)))
      .slice(0, 4);
    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        initial: user.displayName.trim().charAt(0).toUpperCase(),
        language: user.language,
        visibility: user.visibility,
        memberSince: user.createdAt.slice(0, 10),
        isDemo: user.isDemo,
      },
      stats: {
        xp: this.repo.totalXp(user.id),
        stars: { earned: t.stars, max: t.maxStars },
        levels: { completed: t.completed, total: t.total },
      },
      currentLevel: next
        ? { level: next.level, skill: next.skill, recipe: next.recipe, chapter: { chapter: next.chapter, title: getChapter(next.chapter)?.title ?? '' } }
        : null,
      chapters: chapterSummaries(progress),
      streak,
      achievements: { earned: ach.earned, total: ach.total, latest },
      skillPassport: passport.summary,
    };
  }

  skillPassport(user: User) {
    return skillPassport(this.repo.getProgress(user.id));
  }

  settings(user: User) {
    return {
      displayName: user.displayName,
      language: user.language,
      visibility: user.visibility,
      timezone: user.timezone,
      holidaySaveMode: user.holidaySaveMode,
      equipment: this.repo.getEquipment(user.id),
    };
  }

  updateSettings(user: User, patch: { displayName?: string; language?: Language; visibility?: Visibility; timezone?: string; holidaySaveMode?: HolidaySaveMode; equipment?: string[] }) {
    const { equipment, ...fields } = patch;
    if (fields.holidaySaveMode === 'manual' && user.holidaySaveMode === 'auto') {
      // Keep the saves auto mode already spent, so switching modes never rewrites past weeks.
      const { result } = this.streak(user);
      for (const week of result.weeks) {
        if (week.status === 'saved') this.repo.addHolidaySave(user.id, week.weekStart, this.stamp());
      }
    }
    const updated = this.repo.updateUser(user.id, fields);
    if (equipment) this.repo.setEquipment(user.id, equipment);
    return this.settings(updated);
  }

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
    return {
      level,
      stars,
      ...score,
      totalXp: this.repo.totalXp(user.id),
      newAchievements: this.syncAchievements(user),
    };
  }

  setTriedForReal(user: User, level: number, tried: boolean) {
    this.requireLevel(level);
    const p = this.repo.getProgress(user.id).get(level);
    if (tried && !(p && p.bestStars > 0)) {
      throw new ServiceError(409, 'not_practiced', 'Finish the Practice for this level before marking it as tried for real.');
    }
    this.repo.setTriedForReal(user.id, level, tried ? this.stamp() : null);
    return { level, triedForReal: tried, newAchievements: tried ? this.syncAchievements(user) : [] };
  }

  cookLogs(user: User, limit: number): CookLog[] {
    return this.repo.listCookLogs(user.id, limit);
  }

  logCook(user: User, input: { kind: 'cook' | 'bake'; title: string; note?: string; recipeId?: string; cookedOn?: LocalDate }) {
    const today = this.today(user);
    const cookedOn = input.cookedOn ?? today;
    if (cookedOn > today) throw new ServiceError(422, 'future_date', 'A cooking project cannot be logged for a future day.');
    if (daysBetween(cookedOn, today) > this.rules.cookLogBackdateDays) {
      throw new ServiceError(422, 'too_old', `Projects can be logged up to ${this.rules.cookLogBackdateDays} days back.`);
    }
    const log = this.repo.addCookLog(user.id, {
      kind: input.kind,
      title: input.title,
      note: input.note ?? null,
      recipeId: input.recipeId ?? null,
      cookedOn,
      createdAt: this.stamp(),
    });
    return { log, streak: this.streakView(user, 8), newAchievements: this.syncAchievements(user) };
  }

  deleteCookLog(user: User, id: string) {
    if (!this.repo.deleteCookLog(user.id, id)) throw new ServiceError(404, 'not_found', 'No cooking project with this id.');
  }

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
  if (current === 0) return thisWeek === 'done' ? 'Week 1 done. Your streak has started!' : 'Cook or bake one thing this week to start a streak.';
  if (thisWeek === 'done') return `${current} weeks in a row. This week is already covered.`;
  if (thisWeek === 'saved') return 'This week is covered by a Holiday Save. Enjoy your break.';
  return `Cook or bake one thing this week to make it ${current + 1}.`;
}
