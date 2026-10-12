import type { Rules } from './config.ts';
import { addDays, mondayOf, todayIn } from './domain/dates.ts';
import { scoreAttempt } from './domain/xp.ts';
import type { StarResult } from './domain/xp.ts';
import type { Repository } from './store/repository.ts';

export const DEMO_USER_ID = 'demo-alex';

/**
 * The demo profile shown in the designs: Levels 1–6 done (16 stars, 550 XP),
 * Level 7 next, a 2-week cooking streak (Pizza Twists, then the Omelette cooked
 * for the first time) and a second Pizza Twists cook that doesn't count.
 * Finishing Level 7 unlocks the pancakes: a new recipe to make it 3.
 * Dates are relative to "now" so the demo always looks current.
 */
export function seedDemoUser(repo: Repository, rules: Rules, now: Date): void {
  if (repo.getUser(DEMO_USER_ID)) return;
  const timezone = rules.defaultTimezone;
  const today = todayIn(timezone, now);
  const monday = mondayOf(today);
  const weeksAgo = (n: number, day = 2) => addDays(monday, -7 * n + day);
  const stamp = (date: string) => `${date}T17:30:00.000Z`;

  repo.createUser({
    id: DEMO_USER_ID,
    displayName: 'Alex',
    timezone,
    holidaySaveMode: 'auto',
    isDemo: true,
    createdAt: stamp(weeksAgo(7, 0)),
  });
  repo.updateUser(DEMO_USER_ID, { avatarPreset: 'hat-toss' });
  repo.setEquipment(DEMO_USER_ID, ['hob', 'oven', 'pan', 'pot', 'knife', 'whisk']);

  const results: Array<[level: number, stars: StarResult, weeksBack: number]> = [
    [1, 3, 6],
    [2, 3, 6],
    [3, 2, 5],
    [4, 3, 4],
    [5, 3, 2],
    [6, 2, 1],
  ];
  for (const [level, stars, back] of results) {
    const day = weeksAgo(back, 1);
    const score = scoreAttempt(0, stars, rules);
    repo.markLearnCompleted(DEMO_USER_ID, level, stamp(day));
    repo.recordAttempt(DEMO_USER_ID, { level, stars, xpAwarded: score.xpAwarded, bestStars: score.bestStars, playedOn: day, at: stamp(day) });
  }
  repo.setTriedForReal(DEMO_USER_ID, 1, stamp(weeksAgo(6, 3)));
  repo.setTriedForReal(DEMO_USER_ID, 3, stamp(weeksAgo(4, 3)));

  // Cook for Real: each unlocked recipe once, then Pizza Twists again (no streak credit for repeats).
  const cooks: Array<[weeksBack: number, day: number, recipeId: string]> = [
    [2, 2, 'pizza-twists'],
    [1, 2, 'egg-master-omelette'],
    [1, 5, 'pizza-twists'],
  ];
  for (const [back, weekday, recipeId] of cooks) {
    const day = weeksAgo(back, weekday);
    repo.addCooked(DEMO_USER_ID, { recipeId, cookedOn: day, note: null, createdAt: stamp(day) });
  }
}
