import { CHAPTERS, LEVELS } from './curriculum.ts';
import { bestStarsOf, isPassed } from './progress.ts';
import type { ProgressMap } from './progress.ts';

export interface AchievementContext {
  progress: ProgressMap;
  /** How many skills a real cook marked as tried. */
  skillsTried: number;
  projects: { kind: 'cook' | 'bake' }[];
  bestStreak: number;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: (ctx: AchievementContext) => number;
}

const chapterLevels = (chapter: number) => LEVELS.filter((l) => l.chapter === chapter).map((l) => l.level);
const completedIn = (ctx: AchievementContext, chapter: number) =>
  chapterLevels(chapter).filter((n) => isPassed(ctx.progress, n)).length;
const chapterTitle = (chapter: number) => CHAPTERS.find((c) => c.chapter === chapter)?.title ?? '';
const practiceLevels = LEVELS.filter((l) => l.kind === 'practice').map((l) => l.level);

/** Achievements reward learning and real cooking, never time spent or XP grinding. */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-cut', title: 'First Cut', description: 'Finish Level 1', target: 1, progress: (c) => (isPassed(c.progress, 1) ? 1 : 0) },
  { id: 'chapter-champ', title: 'Chapter Champ', description: `Complete ${chapterTitle(1)}`, target: chapterLevels(1).length, progress: (c) => completedIn(c, 1) },
  { id: 'heat-hero', title: 'Heat Hero', description: `Complete ${chapterTitle(2)}`, target: chapterLevels(2).length, progress: (c) => completedIn(c, 2) },
  { id: 'baking-grad', title: 'Baking Grad', description: `Complete ${chapterTitle(3)}`, target: chapterLevels(3).length, progress: (c) => completedIn(c, 3) },
  { id: 'everyday-chef', title: 'Everyday Chef', description: `Complete ${chapterTitle(4)}`, target: chapterLevels(4).length, progress: (c) => completedIn(c, 4) },
  { id: 'perfect-plate', title: 'Perfect Plate', description: 'Earn 3 stars in a Practice', target: 1, progress: (c) => (practiceLevels.some((n) => bestStarsOf(c.progress, n) === 3) ? 1 : 0) },
  // Half of all stars, as before: only Practice levels have stars (8 × 3 = 24).
  { id: 'star-collector', title: 'Star Collector', description: 'Earn 12 stars', target: 12, progress: (c) => practiceLevels.reduce((s, n) => s + bestStarsOf(c.progress, n), 0) },
  { id: 'real-cook', title: 'Real Cook', description: 'Log your first real cooking project', target: 1, progress: (c) => Math.min(1, c.projects.length) },
  { id: 'home-baker', title: 'Home Baker', description: 'Log a baking project', target: 1, progress: (c) => (c.projects.some((p) => p.kind === 'bake') ? 1 : 0) },
  { id: 'five-week-fire', title: 'Five-Week Fire', description: 'Cook for real 5 weeks in a row', target: 5, progress: (c) => c.bestStreak },
  { id: 'ten-week-legend', title: 'Ten-Week Legend', description: 'Cook for real 10 weeks in a row', target: 10, progress: (c) => c.bestStreak },
  { id: 'hands-on', title: 'Hands-on', description: 'Try 5 skills for real', target: 5, progress: (c) => c.skillsTried },
];

export interface AchievementState {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  earned: boolean;
  unlockedAt: string | null;
}

export function evaluateAchievements(ctx: AchievementContext, unlockedAt: ReadonlyMap<string, string>): AchievementState[] {
  return ACHIEVEMENTS.map((a) => {
    const progress = Math.min(a.target, a.progress(ctx));
    const earned = progress >= a.target || unlockedAt.has(a.id);
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      progress: earned ? a.target : progress,
      target: a.target,
      earned,
      unlockedAt: unlockedAt.get(a.id) ?? null,
    };
  });
}
