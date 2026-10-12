import { CHAPTERS, LEVELS, MAX_STARS } from './curriculum.ts';
import type { Level } from './curriculum.ts';

export interface LevelProgress {
  level: number;
  learnCompletedAt: string | null;
  bestStars: number;
  attempts: number;
  firstCompletedAt: string | null;
  triedForRealAt: string | null;
}

/** Evidence levels of the Skill Passport, from weakest to strongest. */
export type SkillStatus = 'new' | 'understood' | 'practiced' | 'tried';

export type ProgressMap = ReadonlyMap<number, LevelProgress>;

export function bestStarsOf(progress: ProgressMap, level: number): number {
  return progress.get(level)?.bestStars ?? 0;
}

export function isCompleted(progress: ProgressMap, level: number): boolean {
  return bestStarsOf(progress, level) > 0;
}

/** Levels unlock in order: a level opens once the one before it has at least one star. */
export function isUnlocked(progress: ProgressMap, level: number): boolean {
  return level === 1 || isCompleted(progress, level - 1);
}

/** Cook for Real opens once every level of the recipe has at least one star. */
export function recipeUnlocked(progress: ProgressMap, recipe: { levels: readonly number[] }): boolean {
  return recipe.levels.every((n) => isCompleted(progress, n));
}

export function currentLevel(progress: ProgressMap): Level | null {
  return LEVELS.find((l) => !isCompleted(progress, l.level)) ?? null;
}

export function skillStatus(p: LevelProgress | undefined): SkillStatus {
  if (!p) return 'new';
  if (p.triedForRealAt) return 'tried';
  if (p.bestStars > 0) return 'practiced';
  if (p.learnCompletedAt) return 'understood';
  return 'new';
}

export function totals(progress: ProgressMap) {
  let stars = 0;
  let completed = 0;
  for (const l of LEVELS) {
    const best = bestStarsOf(progress, l.level);
    stars += best;
    if (best > 0) completed += 1;
  }
  return { stars, maxStars: MAX_STARS, completed, total: LEVELS.length };
}

export function chapterSummaries(progress: ProgressMap) {
  return CHAPTERS.map((c) => {
    const levels = LEVELS.filter((l) => l.chapter === c.chapter);
    const completed = levels.filter((l) => isCompleted(progress, l.level)).length;
    const stars = levels.reduce((sum, l) => sum + bestStarsOf(progress, l.level), 0);
    return {
      chapter: c.chapter,
      title: c.title,
      levels: { from: c.from, to: c.to, completed, total: levels.length },
      stars: { earned: stars, max: levels.length * 3 },
      complete: completed === levels.length,
    };
  });
}

export function skillPassport(progress: ProgressMap) {
  const skills = LEVELS.map((l) => {
    const p = progress.get(l.level);
    const status = skillStatus(p);
    return {
      level: l.level,
      chapter: l.chapter,
      skill: l.skill,
      focus: l.focus,
      recipe: l.recipe,
      status,
      understood: status !== 'new',
      practiced: status === 'practiced' || status === 'tried',
      triedForReal: status === 'tried',
      bestStars: p?.bestStars ?? 0,
      unlocked: isUnlocked(progress, l.level),
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
