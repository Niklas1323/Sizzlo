import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { DEFAULT_RULES } from '../src/config.ts';
import { createApp } from '../src/http/app.ts';
import { DEMO_USER_ID, seedDemoUser } from '../src/seed.ts';
import { ProfileService } from '../src/service/profileService.ts';
import { openDatabase } from '../src/store/db.ts';
import { Repository } from '../src/store/repository.ts';

// Monday 12 October 2026, 10:00 in Zurich.
const NOW = new Date('2026-10-12T08:00:00Z');

let base = '';
let close: () => Promise<void>;

before(async () => {
  const repo = new Repository(openDatabase(':memory:'));
  seedDemoUser(repo, DEFAULT_RULES, NOW);
  const server = createApp({ service: new ProfileService(repo, DEFAULT_RULES, { now: () => NOW }) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
});

after(() => close());

async function call(method: string, path: string, opts: { user?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const user = opts.user === undefined ? DEMO_USER_ID : opts.user;
  if (user) headers['X-User-Id'] = user;
  const res = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

describe('profile API (demo user)', () => {
  test('health check needs no user', async () => {
    assert.deepEqual(await call('GET', '/health', { user: null }), { status: 200, body: { ok: true } });
  });

  test('profile requires a user', async () => {
    const res = await call('GET', '/api/me/profile', { user: null });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'unauthenticated');
    assert.equal((await call('GET', '/api/me/profile', { user: 'nobody' })).status, 401);
  });

  test('profile summary matches the demo design', async () => {
    const { status, body } = await call('GET', '/api/me/profile');
    assert.equal(status, 200);
    assert.equal(body.user.displayName, 'Alex');
    assert.equal(body.user.initial, 'A');
    assert.deepEqual(body.stats, { xp: 550, stars: { earned: 16, max: 60 }, levels: { completed: 6, total: 20 } });
    assert.deepEqual(body.currentLevel, { level: 7, skill: 'Flip Master', recipe: 'Pancake Lab', chapter: { chapter: 2, title: 'Heat & Texture' } });
    assert.equal(body.streak.current, 5);
    assert.equal(body.streak.atRisk, true);
    assert.equal(body.streak.message, 'Cook or bake one thing this week to make it 6.');
    assert.deepEqual(body.streak.holidaySaves, { perYear: 4, usedThisYear: 1, left: 3, mode: 'auto' });
    assert.deepEqual([body.achievements.earned, body.achievements.total], [6, 12]);
    assert.deepEqual(body.skillPassport, { understood: 6, practiced: 6, triedForReal: 2, total: 20 });
    assert.deepEqual(body.chapters.map((c: { complete: boolean }) => c.complete), [true, false, false, false]);
  });

  test('streak history for the last 8 weeks', async () => {
    const { body } = await call('GET', '/api/me/streak?weeks=8');
    assert.deepEqual(
      body.weeks.map((w: { label: string; status: string }) => `${w.label}:${w.status}`),
      ['W35:none', 'W36:done', 'W37:saved', 'W38:done', 'W39:done', 'W40:done', 'W41:done', 'W42:open'],
    );
    assert.equal((await call('GET', '/api/me/streak?weeks=99')).status, 400);
  });

  test('XP per week for the statistics chart', async () => {
    const { body } = await call('GET', '/api/me/stats/xp?weeks=7');
    assert.deepEqual(body.weeks.map((w: { xp: number }) => w.xp), [200, 75, 100, 0, 100, 75, 0]);
    assert.equal(body.total, 550);
    assert.equal(body.bestWeek.label, 'W36');
    assert.equal(body.weeks[6].current, true);
  });

  test('achievements list progress toward the next ones', async () => {
    const { body } = await call('GET', '/api/me/achievements');
    const byId = Object.fromEntries(body.achievements.map((a: { id: string }) => [a.id, a]));
    assert.equal(byId['five-week-fire'].earned, true);
    assert.equal(byId['five-week-fire'].unlockedAt, NOW.toISOString());
    assert.deepEqual([byId['heat-hero'].progress, byId['heat-hero'].target], [2, 5]);
  });

  test('skill passport lists all 20 skills', async () => {
    const { body } = await call('GET', '/api/me/skill-passport');
    assert.equal(body.skills.length, 20);
    assert.equal(body.skills[0].status, 'tried');
    assert.equal(body.skills[6].unlocked, true);
    assert.equal(body.skills[7].unlocked, false);
  });
});

describe('recording progress', () => {
  test('locked levels cannot be played', async () => {
    const res = await call('POST', '/api/me/levels/9/attempts', { body: { stars: 3 } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'level_locked');
    assert.equal((await call('POST', '/api/me/levels/21/attempts', { body: { stars: 3 } })).status, 404);
    assert.equal((await call('POST', '/api/me/levels/7/attempts', { body: { stars: 4 } })).status, 400);
  });

  test('stars: best result stays, replays only add the XP difference', async () => {
    const first = await call('POST', '/api/me/levels/7/attempts', { body: { stars: 2 } });
    assert.equal(first.status, 201);
    assert.deepEqual([first.body.xpAwarded, first.body.bestStars, first.body.totalXp], [75, 2, 625]);

    const better = await call('POST', '/api/me/levels/7/attempts', { body: { stars: 3 } });
    assert.deepEqual([better.body.xpAwarded, better.body.bestStars, better.body.totalXp], [25, 3, 650]);

    const worse = await call('POST', '/api/me/levels/7/attempts', { body: { stars: 1 } });
    assert.deepEqual([worse.body.xpAwarded, worse.body.bestStars, worse.body.newBest], [0, 3, false]);

    const { body } = await call('GET', '/api/me/profile');
    assert.deepEqual(body.stats.stars, { earned: 19, max: 60 });
    assert.equal(body.currentLevel.skill, 'The Sizzle Effect');
  });

  test('tried for real needs a finished Practice and can be undone', async () => {
    assert.equal((await call('PUT', '/api/me/skills/9/tried-for-real')).body.error.code, 'not_practiced');
    assert.equal((await call('PUT', '/api/me/skills/7/tried-for-real')).body.triedForReal, true);
    assert.equal((await call('DELETE', '/api/me/skills/7/tried-for-real')).body.triedForReal, false);
  });

  test('logging a real cook extends the streak this week', async () => {
    const res = await call('POST', '/api/me/cook-logs', { body: { kind: 'cook', title: 'Fluffy Pancakes', recipeId: 'fluffy-pancakes' } });
    assert.equal(res.status, 201);
    assert.equal(res.body.log.cookedOn, '2026-10-12');
    assert.equal(res.body.log.visibility, 'private');
    assert.equal(res.body.streak.current, 6);
    assert.equal(res.body.streak.thisWeek.status, 'done');
    assert.equal(res.body.streak.atRisk, false);

    const list = await call('GET', '/api/me/cook-logs?limit=2');
    assert.equal(list.body.logs[0].title, 'Fluffy Pancakes');
    assert.equal((await call('DELETE', `/api/me/cook-logs/${res.body.log.id}`)).status, 204);
    assert.equal((await call('DELETE', `/api/me/cook-logs/${res.body.log.id}`)).status, 404);
  });

  test('cook logs are validated', async () => {
    assert.equal((await call('POST', '/api/me/cook-logs', { body: { kind: 'grill', title: 'x' } })).status, 400);
    assert.equal((await call('POST', '/api/me/cook-logs', { body: { kind: 'cook' } })).status, 400);
    assert.equal((await call('POST', '/api/me/cook-logs', { body: { kind: 'cook', title: 'Soup', cookedOn: '2026-10-20' } })).body.error.code, 'future_date');
    assert.equal((await call('POST', '/api/me/cook-logs', { body: { kind: 'cook', title: 'Soup', cookedOn: '2026-09-01' } })).body.error.code, 'too_old');
  });
});

describe('settings and Holiday Saves', () => {
  test('settings update with validation', async () => {
    assert.equal((await call('PATCH', '/api/me/settings', { body: { language: 'fr' } })).status, 400);
    assert.equal((await call('PATCH', '/api/me/settings', { body: { equipment: ['spaceship'] } })).status, 400);
    const res = await call('PATCH', '/api/me/settings', { body: { language: 'de', equipment: ['pan', 'oven', 'air-fryer'] } });
    assert.equal(res.status, 200);
    assert.equal(res.body.language, 'de');
    assert.deepEqual(res.body.equipment, ['air-fryer', 'oven', 'pan']);
  });

  test('picking saves needs manual mode, and switching keeps past saves', async () => {
    assert.equal((await call('POST', '/api/me/holiday-saves', { body: { weekStart: '2026-10-19' } })).body.error.code, 'auto_mode');
    await call('PATCH', '/api/me/settings', { body: { holidaySaveMode: 'manual' } });

    const streakAfterSwitch = await call('GET', '/api/me/streak');
    assert.equal(streakAfterSwitch.body.current, 5);

    assert.equal((await call('POST', '/api/me/holiday-saves', { body: { weekStart: '2026-10-21' } })).body.error.code, 'not_monday');
    const picked = await call('POST', '/api/me/holiday-saves', { body: { weekStart: '2026-10-19' } });
    assert.equal(picked.status, 201);
    assert.equal(picked.body.holidaySaves.left, 2);
    assert.equal((await call('DELETE', '/api/me/holiday-saves/2026-10-19')).body.holidaySaves.left, 3);
  });
});

describe('a brand-new user', () => {
  test('starts at Level 1 with an encouraging empty streak', async () => {
    const created = await call('POST', '/api/users', { user: null, body: { displayName: 'Sam', timezone: 'Europe/Berlin' } });
    assert.equal(created.status, 201);
    const { body } = await call('GET', '/api/me/profile', { user: created.body.id });
    assert.equal(body.stats.xp, 0);
    assert.equal(body.currentLevel.level, 1);
    assert.equal(body.streak.current, 0);
    assert.equal(body.streak.message, 'Cook or bake one thing this week to start a streak.');
    assert.equal(body.achievements.earned, 0);
    assert.equal((await call('POST', '/api/users', { user: null, body: { displayName: 'Sam', timezone: 'Mars/Base' } })).status, 400);
  });

  test('unknown routes and methods', async () => {
    assert.equal((await call('GET', '/api/nope')).status, 404);
    assert.equal((await call('DELETE', '/api/me/profile')).status, 405);
  });
});
