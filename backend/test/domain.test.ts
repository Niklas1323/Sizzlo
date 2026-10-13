import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_RULES } from '../src/config.ts';
import { evaluateAchievements } from '../src/domain/achievements.ts';
import { CHAPTERS, LEVELS, MAX_STARS, RECIPES, SKILLS } from '../src/domain/curriculum.ts';
import { isLocalDate, isoWeek, mondayOf, todayIn } from '../src/domain/dates.ts';
import { chapterSummaries, currentLevel, isUnlocked, levelStatus, pathLevels, skillPassport, totals } from '../src/domain/progress.ts';
import type { LevelProgress } from '../src/domain/progress.ts';
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
  test('8 recipes × Learn, Practice, Cook = 24 levels', () => {
    assert.equal(LEVELS.length, 24);
    assert.deepEqual(
      RECIPES.map((r) => r.id),
      ['pizza-twists', 'egg-master-omelette', 'fluffy-pancakes', 'smash-burger-tacos', 'blueberry-vanilla-muffins', 'mac-and-cheese', 'rainbow-crunch-bowl', 'crispy-wrap'],
    );
    for (const [i, r] of RECIPES.entries()) {
      assert.deepEqual(r.levels, { learn: 3 * i + 1, practice: 3 * i + 2, cook: 3 * i + 3 });
      assert.deepEqual(
        LEVELS.filter((l) => l.recipeId === r.id).map((l) => `${l.level}:${l.kind}`),
        [`${3 * i + 1}:learn`, `${3 * i + 2}:practice`, `${3 * i + 3}:cook`],
      );
    }
  });

  test('level titles: the two skills, then the recipe itself', () => {
    assert.deepEqual(
      LEVELS.map((l) => l.title),
      [
        'Safe Cuts', 'Cut & Twist', 'Pizza Twists',
        'Heat Control', 'Perfect Texture', 'Egg Master Omelette',
        'Batter Science', 'Flip Master', 'Fluffy Pancakes',
        'The Sizzle Effect', 'Crispy & Juicy', 'Smash Burger Tacos',
        'Measure Like a Chef', 'Mixing Matters', 'Blueberry Vanilla Muffins',
        'Sauce Science', 'Perfect Timing', 'Mac & Cheese',
        'Knife Skills 2.0', 'Flavor Balance', 'Rainbow Crunch Bowl',
        'Kitchen Organization', 'Kitchen Multitasking', 'Crispy Wrap',
      ],
    );
    assert.deepEqual(LEVELS[2].skills.map((s) => s.id), ['safe-cuts', 'cut-and-twist']);
  });

  test('chapters, access and stars', () => {
    assert.deepEqual(CHAPTERS.map((c) => [c.from, c.to]), [[1, 6], [7, 12], [13, 15], [16, 24]]);
    assert.ok(LEVELS.every((l) => l.chapter === CHAPTERS.find((c) => l.level >= c.from && l.level <= c.to)?.chapter));
    assert.deepEqual(LEVELS.filter((l) => l.access === 'free').map((l) => l.level), Array.from({ length: 15 }, (_, i) => i + 1));
    assert.deepEqual(RECIPES.filter((r) => r.kind === 'bake').map((r) => r.id), ['pizza-twists', 'blueberry-vanilla-muffins']);
    assert.deepEqual(RECIPES.filter((r) => r.recipeStatus === 'proposed').map((r) => r.id), ['rainbow-crunch-bowl', 'crispy-wrap']);
    assert.equal(MAX_STARS, 24);
  });

  test('every skill says which other dishes it helps with', () => {
    assert.equal(SKILLS.length, 16);
    assert.equal(new Set(SKILLS.map((s) => s.id)).size, 16);
    assert.ok(SKILLS.every((s) => s.transfersTo.length > 0));
    const transfers = Object.fromEntries(SKILLS.map((s) => [s.name, s.transfersTo]));
    assert.deepEqual(transfers['Safe Cuts'], ['Veggie prep', 'Herbs', 'Fruit salad']);
    assert.deepEqual(transfers['Flip Master'], ['French toast', 'Burger patties', 'Crêpes']);
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

/** The seeded demo: L1 learn, L2 3★, L3 cooked, L4 learn, L5 2★, L6 cooked, L7 learn. */
const DEMO = progressOf([
  { level: 1, learnCompletedAt: 'x' },
  { level: 2, bestStars: 3, attempts: 1 },
  { level: 3, cookedAt: 'x' },
  { level: 4, learnCompletedAt: 'x' },
  { level: 5, bestStars: 2, attempts: 1 },
  { level: 6, cookedAt: 'x' },
  { level: 7, learnCompletedAt: 'x' },
]);
const DEMO_TRIED = new Map(['safe-cuts', 'cut-and-twist', 'heat-control', 'perfect-texture'].map((id) => [id, 'x']));

describe('levels: unlocking and skipping', () => {
  test('levels unlock in order and the first open level is current', () => {
    assert.equal(isUnlocked(DEMO, 8), true);
    assert.equal(isUnlocked(DEMO, 9), false);
    assert.equal(currentLevel(DEMO)?.title, 'Flip Master');
    assert.deepEqual(
      pathLevels(DEMO).slice(0, 10).map((l) => l.status),
      ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'open', 'locked', 'locked'],
    );
  });

  test('a skipped Cook level is passed: the next recipe opens', () => {
    const skipped = progressOf([...DEMO.values(), { level: 8, bestStars: 1 }, { level: 9, skippedAt: 'x' }]);
    assert.equal(levelStatus(skipped, 9), 'skipped');
    assert.equal(isUnlocked(skipped, 10), true);
    assert.equal(currentLevel(skipped)?.level, 10);
    assert.deepEqual(totals(skipped), { stars: 6, maxStars: 24, completed: 9, total: 24 });
  });

  test('cooking a skipped level later completes it', () => {
    const cooked = progressOf([{ level: 1, learnCompletedAt: 'x' }, { level: 2, bestStars: 1 }, { level: 3, skippedAt: 'x', cookedAt: 'y' }]);
    assert.equal(levelStatus(cooked, 3), 'done');
  });

  test('stars only count on Practice levels', () => {
    const odd = progressOf([...DEMO.values(), { level: 1, learnCompletedAt: 'x', bestStars: 3 }]);
    assert.equal(totals(odd).stars, 5);
    assert.deepEqual(pathLevels(DEMO).slice(0, 3).map((l) => l.bestStars), [null, 3, null]);
    assert.deepEqual(chapterSummaries(DEMO)[0].stars, { earned: 5, max: 6 });
    assert.deepEqual(chapterSummaries(DEMO).map((c) => c.stars.max), [6, 6, 3, 9]);
  });

  test('a Practice level needs a star to be passed, a Learn level only to be finished', () => {
    const p = progressOf([{ level: 1, learnCompletedAt: 'x' }, { level: 2, attempts: 0 }]);
    assert.deepEqual([levelStatus(p, 1), levelStatus(p, 2), levelStatus(p, 3)], ['done', 'open', 'locked']);
  });
});

describe('Skill Passport and achievements', () => {
  test('evidence per skill: Learn done, Practice starred, tried by a real cook', () => {
    const p = skillPassport(DEMO, DEMO_TRIED);
    assert.deepEqual(p.summary, { understood: 6, practiced: 4, triedForReal: 4, total: 16 });
    const byId = Object.fromEntries(p.skills.map((s) => [s.id, s]));
    assert.equal(byId['safe-cuts'].status, 'tried');
    assert.deepEqual(byId['safe-cuts'].transfersTo, ['Veggie prep', 'Herbs', 'Fruit salad']);
    assert.deepEqual([byId['batter-science'].status, byId['flip-master'].status], ['understood', 'understood']);
    assert.deepEqual([byId['flip-master'].level, byId['flip-master'].kind, byId['flip-master'].recipeId], [8, 'practice', 'fluffy-pancakes']);
    assert.equal(byId['sizzle-effect'].status, 'new');
  });

  test('a real cook marks only the stamped skills as tried', () => {
    const p = skillPassport(DEMO, new Map([['cut-and-twist', 'x']]));
    const byId = Object.fromEntries(p.skills.map((s) => [s.id, s]));
    assert.deepEqual([byId['safe-cuts'].status, byId['cut-and-twist'].status], ['practiced', 'tried']);
  });

  test('achievements reflect learning and real cooking', () => {
    const states = evaluateAchievements({ progress: DEMO, skillsTried: 4, projects: [{ kind: 'bake' }, { kind: 'cook' }], bestStreak: 2 }, new Map());
    const earned = states.filter((a) => a.earned).map((a) => a.id);
    assert.deepEqual(earned, ['first-cut', 'chapter-champ', 'perfect-plate', 'real-cook', 'home-baker']);
    assert.deepEqual(states.find((a) => a.id === 'star-collector'), {
      id: 'star-collector', title: 'Star Collector', description: 'Earn 12 stars', progress: 5, target: 12, earned: false, unlockedAt: null,
    });
    assert.deepEqual(states.find((a) => a.id === 'hands-on')?.progress, 4);
  });

  test('a skipped Cook level still completes its chapter', () => {
    const skipped = progressOf([...DEMO.values(), { level: 6, skippedAt: 'x' }]);
    const states = evaluateAchievements({ progress: skipped, skillsTried: 0, projects: [], bestStreak: 0 }, new Map());
    assert.equal(states.find((a) => a.id === 'chapter-champ')?.earned, true);
  });

  test('an unlocked achievement stays earned', () => {
    const states = evaluateAchievements({ progress: new Map(), skillsTried: 0, projects: [], bestStreak: 0 }, new Map([['real-cook', '2026-10-01']]));
    assert.equal(states.find((a) => a.id === 'real-cook')?.earned, true);
  });
});
