import type { Rules } from '../config.ts';

export type StarResult = 1 | 2 | 3;

export function xpForStars(stars: number, rules: Rules): number {
  if (stars <= 0) return 0;
  const capped = Math.min(3, Math.floor(stars)) as StarResult;
  return rules.xpByStars[capped];
}

export interface AttemptScore {
  previousBest: number;
  bestStars: number;
  xpAwarded: number;
  newBest: boolean;
}

/**
 * The best star result of a level never drops, and a replay only earns the XP
 * difference to the previous best, so replaying cannot farm XP.
 */
export function scoreAttempt(previousBest: number, stars: StarResult, rules: Rules): AttemptScore {
  const bestStars = Math.max(previousBest, stars);
  return {
    previousBest,
    bestStars,
    xpAwarded: xpForStars(bestStars, rules) - xpForStars(previousBest, rules),
    newBest: bestStars > previousBest,
  };
}
