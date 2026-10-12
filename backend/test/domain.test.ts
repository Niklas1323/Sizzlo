import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_RULES } from '../src/config.ts';
import { evaluateAchievements } from '../src/domain/achievements.ts';
import { LEVELS, MAX_STARS, RECIPES } from '../src/domain/curriculum.ts';
import { isLocalDate, isoWeek, mondayOf, todayIn } from '../src/domain/dates.ts';
import { currentLevel, isUnlocked, skillPassport } from '../src/domain/progress.ts';
import type { LevelProgress } from '../src/domain/progress.ts';
import { computeStreak, recentWeeks } from '../src/domain/streak.ts';
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
  test('keeps the original 20-level plan', () => {
    assert.equal(LEVELS.length, 20);
    assert.equal(MAX_STARS, 60);
    assert.deepEqual(
      LEVELS.filter((l) => l.access === 'free').map((l) => l.level),
      Array.from({ length: 13 }, (_, i) => i + 1),
    );
    assert.equal(LEVELS[13].recipe, 'Mac & Cheese Master');
  });

  test('every level belongs to exactly one real recipe', () => {
    const covered = RECIPES.flatMap((r) => [...r.levels]).sort((a, b) => a - b);
    assert.deepEqual(covered, LEVELS.map((l) => l.level));
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

const streak = (over: Partial<StreakInput>) =>
  computeStreak({ today: '2026-10-12', projectDates: [], manualSaveWeeks: [], mode: 'auto', savesPerYear: 4, ...over });

const DEMO_PROJECTS = ['2026-09-02', '2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07'];

describe('weekly cooking streak', () => {
  test('no projects yet means no streak', () => {
    const s = streak({});
    assert.equal(s.current, 0);
    assert.equal(s.thisWeek.status, 'open');
    assert.equal(s.atRisk, false);
  });

  test('a Holiday Save protects the streak but does not extend it', () => {
    const s = streak({ projectDates: DEMO_PROJECTS });
    assert.equal(s.current, 5);
    assert.equal(s.best, 5);
    assert.deepEqual(
      s.weeks.map((w) => `${w.label}:${w.status}`),
      ['W36:done', 'W37:saved', 'W38:done', 'W39:done', 'W40:done', 'W41:done', 'W42:open'],
    );
    assert.deepEqual(s.holidaySaves, { perYear: 4, usedThisYear: 1, left: 3, mode: 'auto' });
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

  test('in manual mode a week without a picked save breaks the streak', () => {
    const s = streak({ today: '2026-09-21', projectDates: ['2026-09-02', '2026-09-16'], mode: 'manual' });
    assert.deepEqual(s.weeks.map((w) => w.status), ['done', 'missed', 'done', 'open']);
    assert.equal(s.current, 1);
    assert.equal(s.best, 1);
  });

  test('a picked save covers a missed week in manual mode', () => {
    const s = streak({ today: '2026-09-21', projectDates: ['2026-09-02', '2026-09-16'], mode: 'manual', manualSaveWeeks: ['2026-09-07'] });
    assert.equal(s.current, 2);
    assert.equal(s.holidaySaves.left, 3);
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
    assert.deepEqual(s.holidaySaves, { perYear: 1, usedThisYear: 1, left: 0, mode: 'auto' });
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
  new Map(
    rows.map((r) => [
      r.level,
      { learnCompletedAt: null, bestStars: 0, attempts: 0, firstCompletedAt: null, triedForRealAt: null, ...r } as LevelProgress,
    ]),
  );

describe('progress, Skill Passport and achievements', () => {
  const demo = progressOf([
    { level: 1, bestStars: 3, learnCompletedAt: 'x', triedForRealAt: 'x' },
    { level: 2, bestStars: 3, learnCompletedAt: 'x' },
    { level: 3, bestStars: 2, learnCompletedAt: 'x', triedForRealAt: 'x' },
    { level: 4, bestStars: 3, learnCompletedAt: 'x' },
    { level: 5, bestStars: 3, learnCompletedAt: 'x' },
    { level: 6, bestStars: 2, learnCompletedAt: 'x' },
    { level: 7, learnCompletedAt: 'x' },
  ]);

  test('levels unlock in order and the next open level is current', () => {
    assert.equal(isUnlocked(demo, 7), true);
    assert.equal(isUnlocked(demo, 8), false);
    assert.equal(currentLevel(demo)?.skill, 'Flip Master');
  });

  test('Skill Passport keeps learned, practiced and tried-for-real apart', () => {
    const p = skillPassport(demo);
    assert.deepEqual(p.summary, { understood: 7, practiced: 6, triedForReal: 2, total: 20 });
    assert.equal(p.skills[6].status, 'understood');
    assert.equal(p.skills[0].status, 'tried');
  });

  test('achievements reflect learning and real cooking', () => {
    const states = evaluateAchievements({ progress: demo, projects: [{ kind: 'cook' }, { kind: 'bake' }], bestStreak: 5 }, new Map());
    const earned = states.filter((a) => a.earned).map((a) => a.id);
    assert.deepEqual(earned, ['first-cut', 'chapter-champ', 'perfect-plate', 'real-cook', 'home-baker', 'five-week-fire']);
    assert.deepEqual(states.find((a) => a.id === 'star-collector'), {
      id: 'star-collector', title: 'Star Collector', description: 'Earn 30 stars', progress: 16, target: 30, earned: false, unlockedAt: null,
    });
  });

  test('an unlocked achievement stays earned', () => {
    const states = evaluateAchievements({ progress: new Map(), projects: [], bestStreak: 0 }, new Map([['real-cook', '2026-10-01']]));
    assert.equal(states.find((a) => a.id === 'real-cook')?.earned, true);
  });
});
