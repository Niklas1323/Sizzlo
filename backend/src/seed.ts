import { DEFAULT_EQUIPMENT } from './config.ts';
import type { Rules } from './config.ts';
import { getRecipe, levelOfSkill } from './domain/curriculum.ts';
import type { Level, Recipe } from './domain/curriculum.ts';
import { addDays, mondayOf, todayIn } from './domain/dates.ts';
import { drillFor, PASS_SCORE } from './domain/refresh.ts';
import type { RefreshScore } from './domain/refresh.ts';
import { scoreAttempt } from './domain/xp.ts';
import type { StarResult } from './domain/xp.ts';
import type { Repository } from './store/repository.ts';

export const DEMO_USER_ID = 'demo-alex';

/**
 * The demo profile shown in the designs: Levels 1–12 passed (10 of 30 stars,
 * 810 XP), Level 13 (Flip Master, Fluffy Pancakes) next. Knife Basics is learnt
 * and practised; Pizza Twists and the Omelette are cooked for real, which makes a
 * 2-week streak, and a second Pizza Twists cook doesn't count. Pasta Pomodoro's
 * Cook level was skipped, so it waits in the Recipe Book. Heat Control had one
 * refresh drill (its 10 XP make the 810); the Knife Basics skills haven't been
 * used for weeks and are due for a refresh. Finishing the pancakes is a new
 * recipe to make the streak 3.
 * Dates are relative to "now" so the demo always looks current.
 */
export function seedDemoUser(repo: Repository, rules: Rules, now: Date): void {
  if (repo.getUser(DEMO_USER_ID)) return;
  const timezone = rules.defaultTimezone;
  const today = todayIn(timezone, now);
  const monday = mondayOf(today);
  const weeksAgo = (n: number, day = 2) => addDays(monday, -7 * n + day);
  const stamp = (date: string) => `${date}T17:30:00.000Z`;
  const recipe = (id: string) => getRecipe(id) as Recipe;

  repo.createUser({ id: DEMO_USER_ID, displayName: 'Alex', timezone, isDemo: true, createdAt: stamp(weeksAgo(7, 0)) });
  repo.updateUser(DEMO_USER_ID, { avatarPreset: 'hat-toss' });
  repo.setEquipment(DEMO_USER_ID, DEFAULT_EQUIPMENT);

  const learn = (level: number, on: string) => repo.completeLearn(DEMO_USER_ID, { level, xp: rules.xpForLearn, on, at: stamp(on) });
  const practice = (level: number, stars: StarResult, on: string) => {
    const score = scoreAttempt(0, stars, rules);
    repo.recordAttempt(DEMO_USER_ID, { level, stars, xpAwarded: score.xpAwarded, bestStars: score.bestStars, playedOn: on, at: stamp(on) });
  };
  // Cook for Real without stamps marks the recipe's own skills; only its first cook earns XP.
  const cook = (r: Recipe, on: string, first: boolean) =>
    repo.recordCook(DEMO_USER_ID, {
      recipeId: r.id,
      level: r.levels.cook,
      cookedOn: on,
      note: null,
      skillIds: r.skills.map((s) => s.id),
      xp: first ? rules.xpForFirstCook : 0,
      createdAt: stamp(on),
    });
  const refresh = (skillId: string, score: RefreshScore, on: string) =>
    repo.recordRefresh(DEMO_USER_ID, {
      skillId,
      score,
      level: drillFor(levelOfSkill(skillId) as Level).level,
      xp: score >= PASS_SCORE ? rules.xpForRefresh : 0,
      on,
      at: stamp(on),
    });

  const pizza = recipe('pizza-twists');
  const omelette = recipe('egg-master-omelette');
  learn(1, weeksAgo(6, 1));
  practice(2, 3, weeksAgo(6, 3));
  learn(3, weeksAgo(5, 1));
  practice(4, 3, weeksAgo(4, 1));
  cook(pizza, weeksAgo(2, 2), true);
  learn(6, weeksAgo(2, 3));
  practice(7, 2, weeksAgo(2, 5));
  refresh('heat-control', 3, weeksAgo(1, 1));
  cook(omelette, weeksAgo(1, 2), true);
  learn(9, weeksAgo(1, 3));
  practice(10, 2, weeksAgo(1, 4));
  repo.skipLevel(DEMO_USER_ID, 11, stamp(weeksAgo(1, 4)));
  learn(12, weeksAgo(1, 5));
  cook(pizza, weeksAgo(1, 5), false);
}
