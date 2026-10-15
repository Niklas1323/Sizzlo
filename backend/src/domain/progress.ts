import { CHAPTERS, getLevel, LEVELS, MAX_STARS, SKILL_LEVELS, sourceOf } from './curriculum.ts';
import type { Level } from './curriculum.ts';

/** One user's progress on one level. Which fields are used depends on the level kind. */
export interface LevelProgress {
  level: number;
  /** Learn: video and theory cards finished. */
  learnCompletedAt: string | null;
  /** Practice: best star result (0–3). It never drops. */
  bestStars: number;
  attempts: number;
  /** Cook: the recipe's first real cook. */
  cookedAt: string | null;
  /** Cook: skipped to move on without cooking. Cooking later still completes the level. */
  skippedAt: string | null;
}

/**
 * locked  – the level before it isn't passed yet
 * open    – playable, not finished
 * done    – Learn finished, Practice with at least one star, or Cook cooked for real
 * skipped – a Cook level the user skipped; it can still be cooked later
 */
export type LevelStatus = 'locked' | 'open' | 'done' | 'skipped';

/** Evidence levels of the Skill Passport, from weakest to strongest. */
export type SkillStatus = 'new' | 'understood' | 'practiced' | 'tried';

export type ProgressMap = ReadonlyMap<number, LevelProgress>;

export function bestStarsOf(progress: ProgressMap, level: number): number {
  return progress.get(level)?.bestStars ?? 0;
}

export function isDone(progress: ProgressMap, level: number): boolean {
  const p = progress.get(level);
  if (!p) return false;
  switch (getLevel(level)?.kind) {
    case 'learn':
      return p.learnCompletedAt !== null;
    case 'practice':
      return p.bestStars > 0;
    case 'cook':
      return p.cookedAt !== null;
    default:
      return false;
  }
}

/** Passed on the path: done, or a Cook level that was skipped. */
export function isPassed(progress: ProgressMap, level: number): boolean {
  return isDone(progress, level) || (getLevel(level)?.kind === 'cook' && progress.get(level)?.skippedAt != null);
}

/** Levels unlock in order: a level opens once the one before it is passed. */
export function isUnlocked(progress: ProgressMap, level: number): boolean {
  return level === 1 || isPassed(progress, level - 1);
}

export function levelStatus(progress: ProgressMap, level: number): LevelStatus {
  if (isDone(progress, level)) return 'done';
  if (isPassed(progress, level)) return 'skipped';
  return isUnlocked(progress, level) ? 'open' : 'locked';
}

/** Cook for Real opens with the recipe's Cook level, once the level before it is passed. */
export function recipeUnlocked(progress: ProgressMap, recipe: { levels: { cook: number } }): boolean {
  return isUnlocked(progress, recipe.levels.cook);
}

export function currentLevel(progress: ProgressMap): Level | null {
  return LEVELS.find((l) => !isPassed(progress, l.level)) ?? null;
}

/** Every level with the user's status; stars only on Practice levels. */
export function pathLevels(progress: ProgressMap) {
  return LEVELS.map((l) => ({
    ...l,
    status: levelStatus(progress, l.level),
    bestStars: l.kind === 'practice' ? bestStarsOf(progress, l.level) : null,
  }));
}

const practiceLevels = (levels: readonly Level[]) => levels.filter((l) => l.kind === 'practice');

/** Skipped Cook levels count as completed here, like they do for unlocking. */
export function totals(progress: ProgressMap) {
  return {
    stars: practiceLevels(LEVELS).reduce((sum, l) => sum + bestStarsOf(progress, l.level), 0),
    maxStars: MAX_STARS,
    completed: LEVELS.filter((l) => isPassed(progress, l.level)).length,
    total: LEVELS.length,
  };
}

export function chapterSummaries(progress: ProgressMap) {
  return CHAPTERS.map((c) => {
    const levels = LEVELS.filter((l) => l.chapter === c.chapter);
    const completed = levels.filter((l) => isPassed(progress, l.level)).length;
    const stars = practiceLevels(levels).reduce((sum, l) => sum + bestStarsOf(progress, l.level), 0);
    return {
      chapter: c.chapter,
      title: c.title,
      levels: { from: c.from, to: c.to, completed, total: levels.length },
      stars: { earned: stars, max: practiceLevels(levels).length * 3 },
      complete: completed === levels.length,
    };
  });
}

/**
 * Evidence per skill. The skills of a theory lesson or recipe share its Learn and
 * Practice level: understood once the Learn level is done, practiced once the
 * Practice level has a star (a recipe without a Practice level has no practiced
 * step). Tried comes only from a real cook (`tried`: skill id → when).
 */
export function skillPassport(progress: ProgressMap, tried: ReadonlyMap<string, string>) {
  const skills = SKILL_LEVELS.map((taught) => {
    const { learn, practice } = sourceOf(taught).levels;
    const s = taught.skills[0];
    const understood = isDone(progress, learn);
    const practiced = practice !== null && isDone(progress, practice);
    const triedAt = tried.get(s.id) ?? null;
    const status: SkillStatus = triedAt ? 'tried' : practiced ? 'practiced' : understood ? 'understood' : 'new';
    return {
      ...s,
      level: taught.level,
      kind: taught.kind as 'learn' | 'practice',
      chapter: taught.chapter,
      /** Where it is taught: a theory lesson (lessonId) or a recipe (recipeId). */
      track: taught.track,
      lessonId: taught.lessonId,
      lesson: taught.lesson,
      recipeId: taught.recipeId,
      recipe: taught.recipe,
      status,
      understood,
      practiced,
      triedForReal: triedAt !== null,
      triedAt,
      bestStars: practice === null ? null : bestStarsOf(progress, practice),
      unlocked: isUnlocked(progress, taught.level),
    };
  });
  return {
    summary: {
      understood: skills.filter((s) => s.understood).length,
      practiced: skills.filter((s) => s.practiced).length,
      triedForReal: skills.filter((s) => s.triedForReal).length,
      total: skills.length,
    },
    skills,
  };
}
