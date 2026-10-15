import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_RULES } from '../src/config.ts';
import { evaluateAchievements } from '../src/domain/achievements.ts';
import { CHAPTERS, cookableSkills, getRecipe, LESSONS, LEVELS, MAX_STARS, RECIPES, SKILLS } from '../src/domain/curriculum.ts';
import type { Recipe } from '../src/domain/curriculum.ts';
import { isLocalDate, isoWeek, mondayOf, todayIn } from '../src/domain/dates.ts';
import { chapterSummaries, currentLevel, isUnlocked, levelStatus, pathLevels, recipeUnlocked, skillPassport, totals } from '../src/domain/progress.ts';
import type { LevelProgress } from '../src/domain/progress.ts';
import { dueOn, intervalFor, refreshState, refreshSummary, skillMemory, skillRefresh, strengthOf } from '../src/domain/refresh.ts';
import type { RefreshInput } from '../src/domain/refresh.ts';
import { computeStreak, recentWeeks, streakProjectDates } from '../src/domain/streak.ts';
import type { StreakInput } from '../src/domain/streak.ts';
import { scoreAttempt } from '../src/domain/xp.ts';

describe('dates', () => {
  test('ISO weeks, including year boundaries', () => {
    assert.deepEqual(isoWeek('2026-10-12'), { year: 2026, week: 42 });
    assert.deepEqual(isoWeek('2026-01-01'), { year: 2026, week: 1 });
    assert.deepEqual(isoWeek('2027-01-01'), { year: 2026, week: 53 });
    assert.deepEqual(isoWeek('2024-12-30'), { year: 2025, week: 1 });
    assert.deepEqual(isoWeek('2021-01-03'), { year: 2020, week: 53 });
  });

  test('mondayOf and date validation', () => {
    assert.equal(mondayOf('2026-10-18'), '2026-10-12');
    assert.equal(mondayOf('2026-10-12'), '2026-10-12');
    assert.equal(isLocalDate('2024-02-29'), true);
    assert.equal(isLocalDate('2026-02-30'), false);
    assert.equal(isLocalDate('12.10.2026'), false);
  });

  test('today follows the user time zone', () => {
    const lateEvening = new Date('2026-10-11T22:30:00Z');
    assert.equal(todayIn('Europe/Zurich', lateEvening), '2026-10-12');
    assert.equal(todayIn('UTC', lateEvening), '2026-10-11');
  });
});

describe('curriculum', () => {
  test('skills first: a theory lesson and 10 recipes make 31 levels', () => {
    assert.equal(LEVELS.length, 31);
    assert.deepEqual(LEVELS.map((l) => l.level), Array.from({ length: 31 }, (_, i) => i + 1));
    assert.deepEqual(
      RECIPES.map((r) => r.id),
      [
        'pizza-twists', 'egg-master-omelette', 'pasta-pomodoro', 'fluffy-pancakes', 'blueberry-vanilla-muffins',
        'mac-and-cheese', 'fluffy-rice', 'rainbow-crunch-bowl', 'crispy-wrap', 'caesar-salad',
      ],
    );
    assert.deepEqual(
      RECIPES.map((r) => [r.levels.learn, r.levels.practice, r.levels.cook]),
      [[3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23], [24, 25, 26], [27, 28, 29], [30, null, 31]],
    );
    assert.equal(getRecipe('smash-burger-tacos'), undefined);
  });

  test('a theory lesson is not tied to one recipe: Learn and Practice, no Cook', () => {
    assert.deepEqual(LESSONS.map((l) => [l.id, l.name, l.levels]), [['knife-basics', 'Knife Basics', { learn: 1, practice: 2 }]]);
    assert.deepEqual(LESSONS[0].usedIn, ['pizza-twists', 'egg-master-omelette', 'pasta-pomodoro', 'rainbow-crunch-bowl', 'crispy-wrap', 'caesar-salad']);
    assert.deepEqual(
      LEVELS.slice(0, 2).map((l) => [l.kind, l.track, l.title, l.lessonId, l.lesson, l.recipeId, l.recipe, l.recipeStatus]),
      [
        ['learn', 'theory', 'Knife Basics', 'knife-basics', 'Knife Basics', null, null, null],
        ['practice', 'theory', 'Safe Cuts', 'knife-basics', 'Knife Basics', null, null, null],
      ],
    );
    assert.ok(LEVELS.slice(2).every((l) => l.track === 'recipe' && l.recipeId !== null && l.lessonId === null));
  });

  test('level titles: the skills, then the recipe itself', () => {
    assert.deepEqual(
      LEVELS.map((l) => l.title),
      [
        'Knife Basics', 'Safe Cuts',
        'Pastry Strips', 'Cut & Twist', 'Pizza Twists',
        'Heat Control', 'Perfect Texture', 'Egg Master Omelette',
        'Pasta Know-How', 'Simmer & Season', 'Pasta Pomodoro',
        'Batter Science', 'Flip Master', 'Fluffy Pancakes',
        'Measure Like a Chef', 'Mixing Matters', 'Blueberry Vanilla Muffins',
        'Sauce Science', 'Perfect Timing', 'Mac & Cheese',
        'Rice Ratio', 'Steam & Rest', 'Perfect Fluffy Rice',
        'Knife Skills 2.0', 'Flavor Balance', 'Rainbow Crunch Bowl',
        'Kitchen Organization', 'Kitchen Multitasking', 'Crispy Wrap',
        'Dressing Science', 'Caesar Salad',
      ],
    );
    assert.deepEqual(LEVELS[4].skills.map((s) => s.id), ['pastry-strips', 'cut-and-twist']);
  });

  test('Caesar Salad has two levels: Learn, then Cook', () => {
    const caesar = getRecipe('caesar-salad') as Recipe;
    assert.deepEqual(caesar.levels, { learn: 30, practice: null, cook: 31 });
    assert.deepEqual(LEVELS.filter((l) => l.recipeId === 'caesar-salad').map((l) => `${l.level}:${l.kind}:${l.title}`), ['30:learn:Dressing Science', '31:cook:Caesar Salad']);
    assert.deepEqual(LEVELS[30].skills.map((s) => s.id), ['dressing-science']);
  });

  test('chapters, access and stars', () => {
    assert.deepEqual(CHAPTERS.map((c) => [c.title, c.from, c.to]), [
      ['Knife Skills', 1, 5], ['Heat Control', 6, 14], ['Baking Academy', 15, 17], ['Sauces & Grains', 18, 26], ['Plan & Prep', 27, 31],
    ]);
    assert.ok(LEVELS.every((l) => l.chapter === CHAPTERS.find((c) => l.level >= c.from && l.level <= c.to)?.chapter));
    assert.deepEqual(LEVELS.filter((l) => l.access === 'free').map((l) => l.level), Array.from({ length: 17 }, (_, i) => i + 1));
    assert.deepEqual(RECIPES.filter((r) => r.kind === 'bake').map((r) => r.id), ['pizza-twists', 'blueberry-vanilla-muffins']);
    assert.deepEqual(RECIPES.filter((r) => r.recipeStatus === 'proposed').map((r) => r.id), ['rainbow-crunch-bowl', 'crispy-wrap']);
    assert.equal(MAX_STARS, 30);
  });

  test('every skill says which other dishes it helps with', () => {
    assert.equal(SKILLS.length, 21);
    assert.equal(new Set(SKILLS.map((s) => s.id)).size, 21);
    assert.ok(SKILLS.every((s) => s.transfersTo.length > 0));
    const transfers = Object.fromEntries(SKILLS.map((s) => [s.name, s.transfersTo]));
    assert.deepEqual(transfers['Knife Basics'], ['Veggie prep', 'Herbs', 'Salads']);
    assert.deepEqual(transfers['Safe Cuts'], ['Veggie prep', 'Herbs', 'Fruit salad']);
    assert.deepEqual(transfers['Flip Master'], ['French toast', 'Burger patties', 'Crêpes']);
  });

  test('a real cook may mark the skills of the recipe and of the lessons it applies', () => {
    const ids = (id: string) => cookableSkills(getRecipe(id) as Recipe).map((s) => s.id);
    assert.deepEqual(ids('pizza-twists'), ['pastry-strips', 'cut-and-twist', 'knife-basics', 'safe-cuts']);
    assert.deepEqual(ids('fluffy-pancakes'), ['batter-science', 'flip-master']);
    assert.deepEqual(ids('caesar-salad'), ['dressing-science', 'knife-basics', 'safe-cuts']);
  });
});

describe('xp', () => {
  test('first result earns the full XP for its stars', () => {
    assert.deepEqual(scoreAttempt(0, 2, DEFAULT_RULES), { previousBest: 0, bestStars: 2, xpAwarded: 75, newBest: true });
  });

  test('a better replay only earns the difference', () => {
    assert.equal(scoreAttempt(2, 3, DEFAULT_RULES).xpAwarded, 25);
  });

  test('a replay that is not better earns nothing and never lowers the best', () => {
    assert.deepEqual(scoreAttempt(3, 1, DEFAULT_RULES), { previousBest: 3, bestStars: 3, xpAwarded: 0, newBest: false });
    assert.equal(scoreAttempt(3, 3, DEFAULT_RULES).xpAwarded, 0);
  });
});

const streak = (over: Partial<StreakInput>) => computeStreak({ today: '2026-10-12', projectDates: [], savesPerYear: 4, ...over });

const DEMO_PROJECTS = ['2026-09-02', '2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07'];

describe('weekly cooking streak', () => {
  test('only the first cook of each recipe counts', () => {
    const dates = streakProjectDates([
      { recipeId: 'pizza-twists', cookedOn: '2026-09-30' },
      { recipeId: 'pizza-twists', cookedOn: '2026-09-23' },
      { recipeId: 'egg-master-omelette', cookedOn: '2026-10-07' },
      { recipeId: 'pizza-twists', cookedOn: '2026-10-08' },
    ]);
    assert.deepEqual(dates.sort(), ['2026-09-23', '2026-10-07']);
    assert.equal(streak({ today: '2026-10-08', projectDates: dates, savesPerYear: 0 }).current, 1);
  });

  test('no projects yet means no streak', () => {
    const s = streak({});
    assert.equal(s.current, 0);
    assert.equal(s.thisWeek.status, 'open');
    assert.equal(s.atRisk, false);
  });

  test('a Holiday Save covers a missed week automatically but does not extend the streak', () => {
    const s = streak({ projectDates: DEMO_PROJECTS });
    assert.equal(s.current, 5);
    assert.equal(s.best, 5);
    assert.deepEqual(
      s.weeks.map((w) => `${w.label}:${w.status}`),
      ['W36:done', 'W37:saved', 'W38:done', 'W39:done', 'W40:done', 'W41:done', 'W42:open'],
    );
    assert.deepEqual(s.holidaySaves, { perYear: 4, usedThisYear: 1, left: 3 });
    assert.equal(s.atRisk, true);
  });

  test('cooking this week counts right away', () => {
    const s = streak({ today: '2026-10-14', projectDates: [...DEMO_PROJECTS, '2026-10-13'] });
    assert.equal(s.current, 6);
    assert.equal(s.thisWeek.status, 'done');
    assert.equal(s.atRisk, false);
  });

  test('baking a single thing in a week is enough; several projects still count once', () => {
    const s = streak({ today: '2026-09-23', projectDates: ['2026-09-14', '2026-09-15', '2026-09-22'] });
    assert.equal(s.current, 2);
    assert.equal(s.weeks[0].projects, 2);
  });

  test('Holiday Saves need no mode: every missed week spends one, the current week never does', () => {
    const s = streak({ today: '2026-09-21', projectDates: ['2026-09-02', '2026-09-16'] });
    assert.deepEqual(s.weeks.map((w) => w.status), ['done', 'saved', 'done', 'open']);
    assert.deepEqual([s.current, s.best, s.atRisk], [2, 2, true]);
    assert.deepEqual(s.holidaySaves, { perYear: 4, usedThisYear: 1, left: 3 });
    assert.equal(streak({ today: '2026-09-21', projectDates: ['2026-09-02', '2026-09-16'], savesPerYear: 0 }).current, 1);
  });

  test('when saves run out, the streak restarts', () => {
    const s = streak({ today: '2026-02-02', projectDates: ['2026-01-05', '2026-02-02'], savesPerYear: 1 });
    assert.deepEqual(s.weeks.map((w) => w.status), ['done', 'saved', 'missed', 'missed', 'done']);
    assert.equal(s.current, 1);
    assert.equal(s.best, 1);
    assert.equal(s.holidaySaves.left, 0);
  });

  test('saves reset with each ISO year', () => {
    const s = streak({ today: '2027-01-13', projectDates: ['2026-12-16', '2026-12-30', '2027-01-13'], savesPerYear: 1 });
    assert.deepEqual(
      s.weeks.map((w) => `${w.isoYear}-W${w.isoWeek}:${w.status}`),
      ['2026-W51:done', '2026-W52:saved', '2026-W53:done', '2027-W1:saved', '2027-W2:done'],
    );
    assert.equal(s.current, 3);
    assert.deepEqual(s.holidaySaves, { perYear: 1, usedThisYear: 1, left: 0 });
  });

  test('future dates are ignored', () => {
    assert.equal(streak({ projectDates: ['2026-10-20'] }).current, 0);
  });

  test('recent weeks pad the time before the first project', () => {
    const s = streak({ projectDates: DEMO_PROJECTS });
    const weeks = recentWeeks(s, '2026-10-12', 8);
    assert.deepEqual(weeks.map((w) => w.status), ['none', 'done', 'saved', 'done', 'done', 'done', 'done', 'open']);
    assert.equal(weeks[0].label, 'W35');
  });
});

const progressOf = (rows: Array<Partial<LevelProgress> & { level: number }>) =>
  new Map(rows.map((r) => [r.level, { learnCompletedAt: null, bestStars: 0, attempts: 0, cookedAt: null, skippedAt: null, ...r } as LevelProgress]));

/** Every level up to `last` passed: Learn done, Practice with one star, Cook cooked. */
const passedUpTo = (last: number) =>
  progressOf(LEVELS.filter((l) => l.level <= last).map((l) => ({ level: l.level, learnCompletedAt: 'x', bestStars: l.kind === 'practice' ? 1 : 0, cookedAt: 'x' })));

/**
 * The seeded demo: L1 learn, L2 3★ (Knife Basics), L3 learn, L4 3★, L5 cooked (Pizza Twists),
 * L6 learn, L7 2★, L8 cooked (Omelette), L9 learn, L10 2★, L11 skipped (Pasta), L12 learn.
 */
const DEMO = progressOf([
  { level: 1, learnCompletedAt: 'x' },
  { level: 2, bestStars: 3, attempts: 1 },
  { level: 3, learnCompletedAt: 'x' },
  { level: 4, bestStars: 3, attempts: 1 },
  { level: 5, cookedAt: 'x' },
  { level: 6, learnCompletedAt: 'x' },
  { level: 7, bestStars: 2, attempts: 1 },
  { level: 8, cookedAt: 'x' },
  { level: 9, learnCompletedAt: 'x' },
  { level: 10, bestStars: 2, attempts: 1 },
  { level: 11, skippedAt: 'x' },
  { level: 12, learnCompletedAt: 'x' },
]);
const DEMO_TRIED = new Map(['pastry-strips', 'cut-and-twist', 'heat-control', 'perfect-texture'].map((id) => [id, 'x']));

describe('levels: unlocking and skipping', () => {
  test('levels unlock in order and the first open level is current', () => {
    assert.equal(isUnlocked(DEMO, 13), true);
    assert.equal(isUnlocked(DEMO, 14), false);
    assert.equal(currentLevel(DEMO)?.title, 'Flip Master');
    assert.deepEqual(
      pathLevels(DEMO).slice(0, 15).map((l) => l.status),
      ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'done', 'done', 'done', 'skipped', 'done', 'open', 'locked', 'locked'],
    );
  });

  test('a skipped Cook level is passed: the next recipe opens', () => {
    const skipped = progressOf([...DEMO.values(), { level: 13, bestStars: 1 }, { level: 14, skippedAt: 'x' }]);
    assert.equal(levelStatus(skipped, 14), 'skipped');
    assert.equal(isUnlocked(skipped, 15), true);
    assert.equal(currentLevel(skipped)?.level, 15);
    assert.deepEqual(totals(skipped), { stars: 11, maxStars: 30, completed: 14, total: 31 });
  });

  test('cooking a skipped level later completes it', () => {
    const cooked = progressOf([...passedUpTo(4).values(), { level: 5, skippedAt: 'x', cookedAt: 'y' }]);
    assert.equal(levelStatus(cooked, 5), 'done');
  });

  test('stars only count on Practice levels', () => {
    const odd = progressOf([...DEMO.values(), { level: 1, learnCompletedAt: 'x', bestStars: 3 }]);
    assert.equal(totals(odd).stars, 10);
    assert.deepEqual(pathLevels(DEMO).slice(0, 5).map((l) => l.bestStars), [null, 3, null, 3, null]);
    assert.deepEqual(chapterSummaries(DEMO)[0].stars, { earned: 6, max: 6 });
    assert.deepEqual(chapterSummaries(DEMO).map((c) => c.stars.max), [6, 9, 3, 9, 3]);
  });

  test('a Practice level needs a star to be passed, a Learn level only to be finished', () => {
    const p = progressOf([{ level: 1, learnCompletedAt: 'x' }, { level: 2, attempts: 0 }]);
    assert.deepEqual([levelStatus(p, 1), levelStatus(p, 2), levelStatus(p, 3)], ['done', 'open', 'locked']);
  });

  test('Caesar Salad: Cook for Real opens right after its Learn level', () => {
    const caesar = getRecipe('caesar-salad') as Recipe;
    assert.equal(recipeUnlocked(passedUpTo(29), caesar), false);
    assert.equal(levelStatus(passedUpTo(29), 30), 'open');
    assert.equal(recipeUnlocked(passedUpTo(30), caesar), true);
    assert.equal(currentLevel(passedUpTo(30))?.title, 'Caesar Salad');
    assert.equal(currentLevel(passedUpTo(31)), null);
  });
});

describe('Skill Passport and achievements', () => {
  test('evidence per skill: Learn done, Practice starred, tried by a real cook', () => {
    const p = skillPassport(DEMO, DEMO_TRIED);
    assert.deepEqual(p.summary, { understood: 10, practiced: 8, triedForReal: 4, total: 21 });
    const byId = Object.fromEntries(p.skills.map((s) => [s.id, s]));
    assert.equal(byId['pastry-strips'].status, 'tried');
    assert.deepEqual(byId['safe-cuts'].transfersTo, ['Veggie prep', 'Herbs', 'Fruit salad']);
    assert.deepEqual([byId['batter-science'].status, byId['flip-master'].status], ['understood', 'understood']);
    assert.deepEqual([byId['flip-master'].level, byId['flip-master'].kind, byId['flip-master'].recipeId], [13, 'practice', 'fluffy-pancakes']);
    assert.equal(byId['measure-like-a-chef'].status, 'new');
  });

  test('theory lesson skills get their evidence from the levels of the lesson', () => {
    const byId = Object.fromEntries(skillPassport(DEMO, DEMO_TRIED).skills.map((s) => [s.id, s]));
    const knife = byId['knife-basics'];
    assert.deepEqual(
      [knife.status, knife.level, knife.kind, knife.track, knife.lessonId, knife.lesson, knife.recipeId, knife.recipe, knife.bestStars],
      ['practiced', 1, 'learn', 'theory', 'knife-basics', 'Knife Basics', null, null, 3],
    );
    assert.deepEqual([byId['safe-cuts'].level, byId['safe-cuts'].status], [2, 'practiced']);
    assert.deepEqual([byId['pastry-strips'].track, byId['pastry-strips'].lessonId], ['recipe', null]);
    const tried = skillPassport(DEMO, new Map([['knife-basics', 'x']]));
    assert.equal(tried.skills.find((s) => s.id === 'knife-basics')?.status, 'tried');
  });

  test('a recipe without a Practice level goes from understood to tried', () => {
    const at = (p: ReturnType<typeof passedUpTo>, tried: Map<string, string>) => skillPassport(p, tried).skills.find((s) => s.id === 'dressing-science');
    assert.deepEqual([at(passedUpTo(29), new Map())?.status, at(passedUpTo(29), new Map())?.bestStars], ['new', null]);
    assert.deepEqual([at(passedUpTo(30), new Map())?.status, at(passedUpTo(30), new Map())?.practiced], ['understood', false]);
    assert.equal(at(passedUpTo(31), new Map([['dressing-science', 'x']]))?.status, 'tried');
  });

  test('a real cook marks only the stamped skills as tried', () => {
    const p = skillPassport(DEMO, new Map([['cut-and-twist', 'x']]));
    const byId = Object.fromEntries(p.skills.map((s) => [s.id, s]));
    assert.deepEqual([byId['pastry-strips'].status, byId['cut-and-twist'].status], ['practiced', 'tried']);
  });

  test('achievements reflect learning and real cooking', () => {
    const states = evaluateAchievements({ progress: DEMO, skillsTried: 4, projects: [{ kind: 'bake' }, { kind: 'cook' }], bestStreak: 2 }, new Map());
    const earned = states.filter((a) => a.earned).map((a) => a.id);
    assert.deepEqual(earned, ['first-cut', 'chapter-champ', 'perfect-plate', 'real-cook', 'home-baker']);
    assert.deepEqual(states.find((a) => a.id === 'star-collector'), {
      id: 'star-collector', title: 'Star Collector', description: 'Earn 15 stars', progress: 10, target: 15, earned: false, unlockedAt: null,
    });
    const chapters = states.filter((a) => ['chapter-champ', 'heat-hero', 'baking-grad', 'everyday-chef'].includes(a.id));
    assert.deepEqual(chapters.map((a) => [a.description, a.progress, a.target]), [
      ['Complete Knife Skills', 5, 5],
      ['Complete Heat Control', 7, 9],
      ['Complete Baking Academy', 0, 3],
      ['Complete Sauces & Grains and Plan & Prep', 0, 14],
    ]);
    assert.deepEqual(states.find((a) => a.id === 'hands-on')?.progress, 4);
    assert.equal(states.length, 12);
  });

  test('everyday-chef needs both of the last chapters', () => {
    const ctx = (p: ReturnType<typeof passedUpTo>) => evaluateAchievements({ progress: p, skillsTried: 0, projects: [], bestStreak: 0 }, new Map());
    assert.deepEqual(ctx(passedUpTo(26)).find((a) => a.id === 'everyday-chef')?.progress, 9);
    assert.equal(ctx(passedUpTo(31)).find((a) => a.id === 'everyday-chef')?.earned, true);
  });

  test('a skipped Cook level still completes its chapter', () => {
    const skipped = progressOf([...DEMO.values(), { level: 5, skippedAt: 'x' }]);
    const states = evaluateAchievements({ progress: skipped, skillsTried: 0, projects: [], bestStreak: 0 }, new Map());
    assert.equal(states.find((a) => a.id === 'chapter-champ')?.earned, true);
  });

  test('an unlocked achievement stays earned', () => {
    const states = evaluateAchievements({ progress: new Map(), skillsTried: 0, projects: [], bestStreak: 0 }, new Map([['real-cook', '2026-10-01']]));
    assert.equal(states.find((a) => a.id === 'real-cook')?.earned, true);
  });
});

const refreshOf = (over: Partial<RefreshInput>) =>
  skillRefresh({ today: '2026-10-12', learnedOn: new Map(), practice: [], cooked: [], refreshes: [], ...over });
const moment = (on: string, score: number, at = `${on}T12:00:00.000Z`) => ({ on, at, score });

describe('skill refresh', () => {
  test('the interval grows with each successful review and stops at 120 days', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map(intervalFor), [3, 7, 14, 30, 60, 120, 120, 120]);
  });

  test('strength: 100 right after a review, 50 on the due date, never below 10', () => {
    const memory = { reviews: 0, lastReviewedOn: '2026-10-01' };
    assert.deepEqual(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05', '2026-12-31'].map((d) => strengthOf(memory, d)), [100, 79, 50, 40, 10]);
    assert.equal(dueOn(memory), '2026-10-04');
    const seasoned = { reviews: 5, lastReviewedOn: '2026-10-01' };
    assert.deepEqual([dueOn(seasoned), strengthOf(seasoned, '2027-01-29')], ['2027-01-29', 50]);
    assert.deepEqual([100, 80, 79, 50, 49, 10].map(refreshState), ['fresh', 'fresh', 'fading', 'fading', 'refresh', 'refresh']);
  });

  test('a score of 2 or more is a success; a lower score starts over but still counts as a review', () => {
    assert.deepEqual(skillMemory('2026-09-01', []), { reviews: 0, lastReviewedOn: '2026-09-01' });
    const good = [moment('2026-09-05', 2), moment('2026-09-03', 3)];
    assert.deepEqual(skillMemory('2026-09-01', good), { reviews: 2, lastReviewedOn: '2026-09-05' });
    assert.deepEqual(skillMemory('2026-09-01', [...good, moment('2026-09-10', 1)]), { reviews: 0, lastReviewedOn: '2026-09-10' });
    assert.deepEqual(skillMemory('2026-09-01', [...good, moment('2026-09-10', 0), moment('2026-09-12', 2)]), { reviews: 1, lastReviewedOn: '2026-09-12' });
    // Moments of the same day count in the order they happened.
    const sameDay = [moment('2026-09-03', 1, '2026-09-03T10:00:00Z'), moment('2026-09-03', 3, '2026-09-03T09:00:00Z')];
    assert.equal(skillMemory('2026-09-01', sameDay).reviews, 0);
  });

  test('a skill joins once its Learn level is done; Practice results and real cooks are reviews', () => {
    assert.deepEqual(refreshOf({}), { due: [], skills: [] });
    const r = refreshOf({
      learnedOn: new Map([[6, '2026-10-01']]),
      practice: [{ level: 7, stars: 2, on: '2026-10-03', at: '2026-10-03T17:00:00Z' }],
      cooked: [{ skillId: 'heat-control', on: '2026-10-07', at: '2026-10-07T17:00:00Z' }],
    });
    assert.deepEqual(r.skills.map((s) => [s.id, s.reviews, s.lastReviewedOn, s.strength, s.state]), [
      ['heat-control', 2, '2026-10-07', 78, 'fading'],
      ['perfect-texture', 1, '2026-10-03', 41, 'refresh'],
    ]);
    assert.deepEqual(r.skills[0].drill, { level: 7, kind: 'practice', minutes: 2 });
    assert.deepEqual(r.due.map((s) => s.id), ['perfect-texture']);
    // A one-star Practice is a review moment that starts the intervals over.
    const weak = refreshOf({ learnedOn: new Map([[6, '2026-10-01']]), practice: [{ level: 7, stars: 1, on: '2026-10-11', at: 'x' }] });
    assert.deepEqual([weak.skills[0].reviews, weak.skills[0].strength, weak.skills[0].dueOn], [0, 79, '2026-10-14']);
  });

  test('drills: the lesson or recipe Practice level, or the Learn level when there is none', () => {
    const r = refreshOf({ learnedOn: new Map([[1, '2026-10-12'], [30, '2026-10-12']]) });
    assert.deepEqual(r.skills.map((s) => [s.id, s.drill.level, s.drill.kind, s.strength, s.state]), [
      ['knife-basics', 2, 'practice', 100, 'fresh'],
      ['safe-cuts', 2, 'practice', 100, 'fresh'],
      ['dressing-science', 30, 'learn', 100, 'fresh'],
    ]);
  });

  test('due skills: weakest first, then the older review, then path order; at most 3', () => {
    const r = refreshOf({ learnedOn: new Map([[1, '2026-09-01'], [3, '2026-08-01'], [6, '2026-10-06']]) });
    assert.deepEqual(r.skills.map((s) => [s.id, s.strength]), [
      ['knife-basics', 10], ['safe-cuts', 10], ['pastry-strips', 10], ['cut-and-twist', 10], ['heat-control', 25], ['perfect-texture', 25],
    ]);
    assert.deepEqual(r.due.map((s) => s.id), ['pastry-strips', 'cut-and-twist', 'knife-basics']);
    assert.deepEqual(refreshSummary(r.skills), { due: 6, weakest: { id: 'pastry-strips', name: 'Pastry Strips', strength: 10 } });
    assert.deepEqual(refreshSummary([]), { due: 0, weakest: null });
  });
});
