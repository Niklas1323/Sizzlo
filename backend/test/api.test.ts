import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { DEFAULT_RULES } from '../src/config.ts';
import { createApp } from '../src/http/app.ts';
import { DEMO_USER_ID, seedDemoUser } from '../src/seed.ts';
import { ProfileService } from '../src/service/profileService.ts';
import { openDatabase } from '../src/store/db.ts';
import { MediaStore } from '../src/store/media.ts';
import { Repository } from '../src/store/repository.ts';

// Monday 12 October 2026, 10:00 in Zurich.
const NOW = new Date('2026-10-12T08:00:00Z');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake-jpeg-body')]);

let base = '';
let mediaDir = '';
let close: () => Promise<void>;

before(async () => {
  mediaDir = mkdtempSync(join(tmpdir(), 'sizzlo-media-'));
  const repo = new Repository(openDatabase(':memory:'));
  seedDemoUser(repo, DEFAULT_RULES, NOW);
  const service = new ProfileService(repo, new MediaStore(mediaDir), DEFAULT_RULES, { now: () => NOW });
  const server = createApp({ service, maxPhotoBytes: 1024 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
});

after(async () => {
  await close();
  rmSync(mediaDir, { recursive: true, force: true });
});

async function call(method: string, path: string, opts: { user?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const user = opts.user === undefined ? DEMO_USER_ID : opts.user;
  if (user) headers['X-User-Id'] = user;
  const res = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function upload(path: string, data: Buffer, type: string) {
  const res = await fetch(base + path, { method: 'PUT', headers: { 'X-User-Id': DEMO_USER_ID, 'Content-Type': type }, body: data });
  return { status: res.status, body: (await res.json()) as { photoUrl?: string | null; avatarUrl?: string | null } };
}

async function download(path: string) {
  const res = await fetch(base + path, { headers: { 'X-User-Id': DEMO_USER_ID } });
  return { status: res.status, type: res.headers.get('content-type'), data: Buffer.from(await res.arrayBuffer()) };
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
    assert.equal(body.user.avatarUrl, null);
    assert.equal(body.user.avatarPreset, 'hat-toss');
    assert.deepEqual(body.stats, { xp: 550, stars: { earned: 16, max: 60 }, levels: { completed: 6, total: 20 }, recipesCooked: 2 });
    assert.deepEqual(body.currentLevel, { level: 7, skill: 'Flip Master', recipe: 'Pancake Lab', chapter: { chapter: 2, title: 'Heat & Texture' } });
    assert.equal(body.streak.current, 5);
    assert.equal(body.streak.message, 'Cook a recipe this week to make it 6.');
    assert.deepEqual(body.streak.holidaySaves, { perYear: 4, usedThisYear: 1, left: 3, mode: 'auto' });
    assert.deepEqual([body.achievements.earned, body.achievements.total], [6, 12]);
    assert.deepEqual(body.skillPassport, { understood: 6, practiced: 6, triedForReal: 2, total: 20 });
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
  });

  test('achievements and skill passport', async () => {
    const ach = await call('GET', '/api/me/achievements');
    const byId = Object.fromEntries(ach.body.achievements.map((a: { id: string }) => [a.id, a]));
    assert.equal(byId['home-baker'].earned, true);
    assert.deepEqual([byId['heat-hero'].progress, byId['heat-hero'].target], [2, 5]);
    const passport = await call('GET', '/api/me/skill-passport');
    assert.equal(passport.body.skills.length, 20);
    assert.equal(passport.body.skills[0].status, 'tried');
  });
});

describe('recipe book', () => {
  test('lists cooked, ready and locked recipes', async () => {
    const { body } = await call('GET', '/api/me/recipe-book');
    const byId = Object.fromEntries(body.recipes.map((r: { id: string }) => [r.id, r]));
    assert.equal(body.recipes.length, 8);
    assert.deepEqual([byId['pizza-twists'].status, byId['pizza-twists'].timesCooked], ['cooked', 2]);
    assert.deepEqual([byId['egg-master-omelette'].status, byId['egg-master-omelette'].timesCooked], ['cooked', 3]);
    assert.equal(byId['fluffy-pancakes'].status, 'locked');
    assert.deepEqual(byId['fluffy-pancakes'].levels, { from: 5, to: 7, done: 2, total: 3 });
    assert.equal(byId['pizza-twists'].photoUrl, null);
    assert.equal(body.planned.length, 2);
  });

  test('real cooking only counts for unlocked Sizzlo recipes', async () => {
    const locked = await call('POST', '/api/me/recipes/smash-burger-tacos/cooked', { body: {} });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error.code, 'recipe_locked');
    assert.equal((await call('POST', '/api/me/recipes/banana-bread/cooked', { body: {} })).status, 404);
    assert.equal((await call('POST', '/api/me/cook-logs', { body: { kind: 'cook', title: 'Anything' } })).status, 404);
  });
});

describe('levels, then Cook for Real with a photo', () => {
  test('locked levels cannot be played', async () => {
    assert.equal((await call('POST', '/api/me/levels/9/attempts', { body: { stars: 3 } })).body.error.code, 'level_locked');
    assert.equal((await call('POST', '/api/me/levels/21/attempts', { body: { stars: 3 } })).status, 404);
    assert.equal((await call('POST', '/api/me/levels/7/attempts', { body: { stars: 4 } })).status, 400);
  });

  test('best stars stay, replays add only the XP difference, the last level opens the recipe', async () => {
    const first = await call('POST', '/api/me/levels/7/attempts', { body: { stars: 2 } });
    assert.equal(first.status, 201);
    assert.deepEqual([first.body.xpAwarded, first.body.totalXp], [75, 625]);
    assert.deepEqual(first.body.recipeReady, { id: 'fluffy-pancakes', name: 'Fluffy Pancakes' });

    const better = await call('POST', '/api/me/levels/7/attempts', { body: { stars: 3 } });
    assert.deepEqual([better.body.xpAwarded, better.body.bestStars, better.body.totalXp], [25, 3, 650]);
    const worse = await call('POST', '/api/me/levels/7/attempts', { body: { stars: 1 } });
    assert.deepEqual([worse.body.xpAwarded, worse.body.bestStars], [0, 3]);
  });

  test('cooking the pancakes for real extends the streak', async () => {
    const res = await call('POST', '/api/me/recipes/fluffy-pancakes/cooked', { body: {} });
    assert.equal(res.status, 201);
    assert.equal(res.body.entry.recipeName, 'Fluffy Pancakes');
    assert.equal(res.body.entry.cookedOn, '2026-10-12');
    assert.equal(res.body.entry.photoUrl, null);
    assert.equal(res.body.streak.current, 6);
    assert.equal(res.body.streak.thisWeek.status, 'done');

    const entryId = res.body.entry.id;
    assert.equal(res.body.photoUploadUrl, `/api/me/cooked/${entryId}/photo`);

    const photo = await upload(`/api/me/cooked/${entryId}/photo`, PNG, 'image/png');
    assert.equal(photo.status, 200);
    assert.equal(photo.body.photoUrl, `/api/me/cooked/${entryId}/photo`);

    const got = await download(`/api/me/cooked/${entryId}/photo`);
    assert.deepEqual([got.status, got.type], [200, 'image/png']);
    assert.ok(got.data.equals(PNG));

    const book = await call('GET', '/api/me/recipe-book');
    const pancakes = book.body.recipes.find((r: { id: string }) => r.id === 'fluffy-pancakes');
    assert.deepEqual([pancakes.status, pancakes.photoUrl], ['cooked', `/api/me/cooked/${entryId}/photo`]);

    assert.equal((await call('DELETE', `/api/me/cooked/${entryId}/photo`)).body.photoUrl, null);
    assert.equal((await download(`/api/me/cooked/${entryId}/photo`)).status, 404);
  });

  test('photo uploads must really be images and not too large', async () => {
    const [entry] = (await call('GET', '/api/me/cooked?limit=1')).body.entries;
    assert.equal((await upload(`/api/me/cooked/${entry.id}/photo`, Buffer.from('hello'), 'text/plain')).status, 415);
    assert.equal((await upload(`/api/me/cooked/${entry.id}/photo`, Buffer.from('not a png'), 'image/png')).status, 415);
    assert.equal((await upload(`/api/me/cooked/${entry.id}/photo`, Buffer.concat([PNG, Buffer.alloc(2048)]), 'image/png')).status, 413);
    assert.equal((await upload('/api/me/cooked/does-not-exist/photo', PNG, 'image/png')).status, 404);
  });

  test('cook records are validated', async () => {
    assert.equal((await call('POST', '/api/me/recipes/pizza-twists/cooked', { body: { cookedOn: '2026-10-20' } })).body.error.code, 'future_date');
    assert.equal((await call('POST', '/api/me/recipes/pizza-twists/cooked', { body: { cookedOn: '2026-09-01' } })).body.error.code, 'too_old');
    assert.equal((await call('POST', '/api/me/recipes/pizza-twists/cooked', { body: { cookedOn: 'tuesday' } })).status, 400);
  });

  test('tried for real needs a finished Practice', async () => {
    assert.equal((await call('PUT', '/api/me/skills/9/tried-for-real')).body.error.code, 'not_practiced');
    assert.equal((await call('PUT', '/api/me/skills/7/tried-for-real')).body.triedForReal, true);
    assert.equal((await call('DELETE', '/api/me/skills/7/tried-for-real')).body.triedForReal, false);
  });
});

describe('editing the profile', () => {
  test('name and settings', async () => {
    assert.equal((await call('PATCH', '/api/me/settings', { body: { displayName: '' } })).status, 400);
    assert.equal((await call('PATCH', '/api/me/settings', { body: { language: 'fr' } })).status, 400);
    const res = await call('PATCH', '/api/me/settings', { body: { displayName: 'Alexa', language: 'de', equipment: ['pan', 'oven'] } });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.displayName, res.body.language, res.body.equipment], ['Alexa', 'de', ['oven', 'pan']]);
    assert.equal((await call('GET', '/api/me/profile')).body.user.displayName, 'Alexa');
  });

  test('profile picture upload, read and remove', async () => {
    const put = await upload('/api/me/avatar', JPEG, 'image/jpeg');
    assert.deepEqual(put, { status: 200, body: { avatarUrl: '/api/me/avatar' } });
    assert.equal((await call('GET', '/api/me/profile')).body.user.avatarUrl, '/api/me/avatar');
    const got = await download('/api/me/avatar');
    assert.deepEqual([got.status, got.type], [200, 'image/jpeg']);
    assert.ok(got.data.equals(JPEG));
    assert.deepEqual((await call('DELETE', '/api/me/avatar')).body, { avatarUrl: null });
    assert.equal((await download('/api/me/avatar')).status, 404);
  });

  test('avatar presets: one profile picture at a time', async () => {
    const user = async () => (await call('GET', '/api/me/profile')).body.user;
    const set = await call('PATCH', '/api/me/settings', { body: { avatarPreset: 'avocado' } });
    assert.equal(set.body.avatarPreset, 'avocado');
    assert.equal((await user()).avatarPreset, 'avocado');
    const bad = await call('PATCH', '/api/me/settings', { body: { avatarPreset: 'pizza' } });
    assert.deepEqual([bad.status, bad.body.error.code], [400, 'invalid_field']);

    await upload('/api/me/avatar', PNG, 'image/png');
    assert.deepEqual([(await user()).avatarUrl, (await user()).avatarPreset], ['/api/me/avatar', null]);

    await call('PATCH', '/api/me/settings', { body: { avatarPreset: 'pizza-slice' } });
    assert.deepEqual([(await user()).avatarUrl, (await user()).avatarPreset], [null, 'pizza-slice']);
    assert.equal((await download('/api/me/avatar')).status, 404);

    await call('PATCH', '/api/me/settings', { body: { avatarPreset: null } });
    assert.equal((await user()).avatarPreset, null);
  });

  test('picking Holiday Saves needs manual mode, and switching keeps past saves', async () => {
    assert.equal((await call('POST', '/api/me/holiday-saves', { body: { weekStart: '2026-10-19' } })).body.error.code, 'auto_mode');
    await call('PATCH', '/api/me/settings', { body: { holidaySaveMode: 'manual' } });
    assert.equal((await call('GET', '/api/me/streak')).body.current, 6);
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
    assert.equal(body.streak.message, 'Cook a Sizzlo recipe this week to start a streak.');
    assert.equal(body.achievements.earned, 0);
    const book = await call('GET', '/api/me/recipe-book', { user: created.body.id });
    assert.ok(book.body.recipes.every((r: { status: string }) => r.status === 'locked'));
    assert.equal((await call('POST', '/api/users', { user: null, body: { displayName: 'Sam', timezone: 'Mars/Base' } })).status, 400);
  });

  test('unknown routes and methods', async () => {
    assert.equal((await call('GET', '/api/nope')).status, 404);
    assert.equal((await call('DELETE', '/api/me/profile')).status, 405);
  });
});
