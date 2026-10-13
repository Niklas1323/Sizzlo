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
    assert.equal('visibility' in body.user, false);
    assert.deepEqual(body.stats, { xp: 525, stars: { earned: 5, max: 24 }, levels: { completed: 7, total: 24 }, recipesCooked: 2 });
    assert.deepEqual(body.currentLevel, {
      level: 8,
      kind: 'practice',
      title: 'Flip Master',
      recipeId: 'fluffy-pancakes',
      recipe: 'Fluffy Pancakes',
      skills: [{ id: 'flip-master', name: 'Flip Master', focus: 'Flipping, doneness cues, browning', transfersTo: ['French toast', 'Burger patties', 'Crêpes'] }],
      chapter: { chapter: 2, title: 'Heat & Texture' },
    });
    assert.deepEqual(body.chapters[0], {
      chapter: 1, title: 'Kitchen Foundations', levels: { from: 1, to: 6, completed: 6, total: 6 }, stars: { earned: 5, max: 6 }, complete: true,
    });
    assert.equal(body.streak.current, 2);
    assert.equal(body.streak.message, 'Cook a new recipe this week to make it 3.');
    assert.deepEqual(body.streak.holidaySaves, { perYear: 4, usedThisYear: 0, left: 4 });
    assert.deepEqual([body.achievements.earned, body.achievements.total], [5, 12]);
    assert.deepEqual(body.skillPassport, { understood: 6, practiced: 4, triedForReal: 4, total: 16 });
  });

  test('streak history for the last 8 weeks', async () => {
    const { body } = await call('GET', '/api/me/streak?weeks=8');
    assert.deepEqual(
      body.weeks.map((w: { label: string; status: string }) => `${w.label}:${w.status}`),
      ['W35:none', 'W36:none', 'W37:none', 'W38:none', 'W39:none', 'W40:done', 'W41:done', 'W42:open'],
    );
    assert.equal((await call('GET', '/api/me/streak?weeks=99')).status, 400);
  });

  test('XP per week for the statistics chart', async () => {
    const { body } = await call('GET', '/api/me/stats/xp?weeks=7');
    // Learn 50, Practice 50/75/100 by stars, first real cook 100: L1 · L2 3★ · L3 + L4 + L5 2★ · L6 + L7.
    assert.deepEqual(body.weeks.map((w: { xp: number }) => w.xp), [0, 50, 100, 0, 225, 150, 0]);
    assert.equal(body.total, 525);
  });

  test('achievements and skill passport', async () => {
    const ach = await call('GET', '/api/me/achievements');
    const byId = Object.fromEntries(ach.body.achievements.map((a: { id: string }) => [a.id, a]));
    assert.equal(byId['home-baker'].earned, true);
    assert.deepEqual([byId['heat-hero'].progress, byId['heat-hero'].target], [1, 6]);
    assert.deepEqual([byId['star-collector'].progress, byId['star-collector'].target], [5, 12]);
    assert.deepEqual([byId['hands-on'].progress, byId['hands-on'].earned], [4, false]);
    const passport = await call('GET', '/api/me/skill-passport');
    assert.equal(passport.body.skills.length, 16);
    assert.deepEqual(passport.body.skills[0], {
      id: 'safe-cuts',
      name: 'Safe Cuts',
      focus: 'Knife and tool safety, cut sizes',
      transfersTo: ['Veggie prep', 'Herbs', 'Fruit salad'],
      level: 1,
      kind: 'learn',
      chapter: 1,
      recipeId: 'pizza-twists',
      recipe: 'Pizza Twists',
      status: 'tried',
      understood: true,
      practiced: true,
      triedForReal: true,
      triedAt: '2026-09-30T17:30:00.000Z',
      bestStars: 3,
      unlocked: true,
    });
    assert.deepEqual(passport.body.skills.slice(4, 6).map((s: { status: string }) => s.status), ['understood', 'understood']);
  });

  test('the path shows every level with its kind, recipe and status', async () => {
    const { body } = await call('GET', '/api/me/path');
    assert.equal(body.currentLevel, 8);
    assert.equal(body.levels.length, 24);
    assert.equal(body.chapters.length, 4);
    assert.deepEqual(
      body.levels.slice(0, 10).map((l: { level: number; kind: string; status: string }) => `${l.level}:${l.kind}:${l.status}`),
      ['1:learn:done', '2:practice:done', '3:cook:done', '4:learn:done', '5:practice:done', '6:cook:done', '7:learn:done', '8:practice:open', '9:cook:locked', '10:learn:locked'],
    );
    assert.deepEqual(body.levels.slice(0, 3).map((l: { bestStars: number | null }) => l.bestStars), [null, 3, null]);
    const cook = body.levels[2];
    assert.deepEqual([cook.title, cook.recipeId, cook.skills.map((s: { id: string }) => s.id)], ['Pizza Twists', 'pizza-twists', ['safe-cuts', 'cut-and-twist']]);
    assert.deepEqual(cook.skills[1].transfersTo, ['Hand pies', 'Cheese straws', 'Cookies']);
  });

  test('the curriculum lists 24 levels with kinds and skills', async () => {
    const { body } = await call('GET', '/api/curriculum', { user: null });
    assert.deepEqual([body.chapters.length, body.levels.length, body.recipes.length], [4, 24, 8]);
    assert.deepEqual(body.levels.slice(15, 18).map((l: { kind: string; access: string; recipeId: string }) => [l.kind, l.access, l.recipeId]), [
      ['learn', 'plus', 'mac-and-cheese'],
      ['practice', 'plus', 'mac-and-cheese'],
      ['cook', 'plus', 'mac-and-cheese'],
    ]);
    assert.deepEqual(body.recipes[2].levels, { learn: 7, practice: 8, cook: 9 });
    assert.ok(body.levels.every((l: { skills: { transfersTo: string[] }[] }) => l.skills.every((s) => s.transfersTo.length > 0)));
  });
});

describe('recipe book', () => {
  test('lists cooked, ready and locked recipes', async () => {
    const { body } = await call('GET', '/api/me/recipe-book');
    const byId = Object.fromEntries(body.recipes.map((r: { id: string }) => [r.id, r]));
    assert.equal(body.recipes.length, 8);
    assert.deepEqual([byId['pizza-twists'].status, byId['pizza-twists'].timesCooked], ['cooked', 2]);
    assert.deepEqual([byId['egg-master-omelette'].status, byId['egg-master-omelette'].timesCooked], ['cooked', 1]);
    assert.deepEqual([byId['pizza-twists'].countsForStreak, byId['fluffy-pancakes'].countsForStreak], [false, true]);
    assert.equal(byId['fluffy-pancakes'].status, 'locked');
    assert.deepEqual(byId['fluffy-pancakes'].levels, { from: 7, to: 9, done: 1, total: 3 });
    assert.deepEqual(byId['fluffy-pancakes'].cookLevel, { level: 9, status: 'locked' });
    assert.deepEqual(byId['pizza-twists'].cookLevel, { level: 3, status: 'done' });
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

describe('levels: Learn, Practice, Cook', () => {
  test('each action only works on its own kind of level', async () => {
    const wrong = await call('POST', '/api/me/levels/8/learn');
    assert.deepEqual([wrong.status, wrong.body.error.code], [400, 'wrong_level_kind']);
    // Stars only exist on Practice levels.
    assert.equal((await call('POST', '/api/me/levels/7/attempts', { body: { stars: 3 } })).body.error.code, 'wrong_level_kind');
    assert.equal((await call('POST', '/api/me/levels/6/attempts', { body: { stars: 3 } })).body.error.code, 'wrong_level_kind');
    assert.equal((await call('POST', '/api/me/levels/11/attempts', { body: { stars: 3 } })).body.error.code, 'level_locked');
    assert.equal((await call('POST', '/api/me/levels/25/attempts', { body: { stars: 3 } })).status, 404);
    assert.equal((await call('POST', '/api/me/levels/8/attempts', { body: { stars: 4 } })).status, 400);
  });

  test('only an unlocked Cook level can be skipped', async () => {
    assert.deepEqual((await call('POST', '/api/me/levels/8/skip')).body.error.code, 'wrong_level_kind');
    assert.deepEqual((await call('POST', '/api/me/levels/7/skip')).status, 400);
    const locked = await call('POST', '/api/me/levels/9/skip');
    assert.deepEqual([locked.status, locked.body.error.code], [409, 'level_locked']);
    assert.equal((await call('POST', '/api/me/levels/25/skip')).status, 404);
    assert.equal((await call('POST', '/api/me/levels/10/learn')).body.error.code, 'level_locked');
  });

  test('best stars stay, replays add only the XP difference, Practice opens the Cook level', async () => {
    const first = await call('POST', '/api/me/levels/8/attempts', { body: { stars: 2 } });
    assert.equal(first.status, 201);
    assert.deepEqual([first.body.xpAwarded, first.body.totalXp], [75, 600]);
    assert.deepEqual(first.body.recipeReady, { id: 'fluffy-pancakes', name: 'Fluffy Pancakes', cookLevel: 9 });

    const better = await call('POST', '/api/me/levels/8/attempts', { body: { stars: 3 } });
    assert.deepEqual([better.body.xpAwarded, better.body.bestStars, better.body.totalXp], [25, 3, 625]);
    const worse = await call('POST', '/api/me/levels/8/attempts', { body: { stars: 1 } });
    assert.deepEqual([worse.body.xpAwarded, worse.body.bestStars], [0, 3]);
  });

  test('skipping the Cook level opens the next recipe', async () => {
    const skipped = await call('POST', '/api/me/levels/9/skip');
    assert.equal(skipped.status, 200);
    assert.deepEqual(skipped.body, {
      level: 9,
      status: 'skipped',
      nextLevel: { level: 10, kind: 'learn', title: 'The Sizzle Effect', recipeId: 'smash-burger-tacos' },
      newAchievements: [],
    });
    assert.equal((await call('POST', '/api/me/levels/9/skip')).body.status, 'skipped');

    const learn = await call('POST', '/api/me/levels/10/learn');
    assert.deepEqual([learn.status, learn.body.xpAwarded, learn.body.totalXp], [200, 50, 675]);
    assert.equal((await call('POST', '/api/me/levels/10/learn')).body.xpAwarded, 0);

    const path = (await call('GET', '/api/me/path')).body;
    assert.deepEqual(path.levels.slice(8, 11).map((l: { status: string }) => l.status), ['skipped', 'done', 'open']);
    assert.equal(path.currentLevel, 11);
    const book = await call('GET', '/api/me/recipe-book');
    const pancakes = book.body.recipes.find((r: { id: string }) => r.id === 'fluffy-pancakes');
    assert.deepEqual([pancakes.status, pancakes.cookLevel], ['ready', { level: 9, status: 'skipped' }]);
  });

  test('cooking the skipped pancakes completes the level, marks the skills tried and extends the streak', async () => {
    const res = await call('POST', '/api/me/recipes/fluffy-pancakes/cooked', { body: {} });
    assert.equal(res.status, 201);
    assert.equal(res.body.entry.recipeName, 'Fluffy Pancakes');
    assert.equal(res.body.entry.cookedOn, '2026-10-12');
    assert.equal(res.body.entry.photoUrl, null);
    assert.deepEqual(res.body.cookLevel, { level: 9, status: 'done' });
    assert.deepEqual([res.body.xpAwarded, res.body.totalXp], [100, 775]);
    assert.deepEqual(res.body.skillsTried, ['batter-science', 'flip-master']);
    assert.equal(res.body.countsForStreak, true);
    assert.equal(res.body.streak.current, 3);
    assert.equal(res.body.streak.thisWeek.status, 'done');

    const passport = (await call('GET', '/api/me/skill-passport')).body;
    assert.deepEqual(passport.skills.slice(4, 6).map((s: { status: string }) => s.status), ['tried', 'tried']);
    assert.equal(passport.summary.triedForReal, 6);
    assert.equal((await call('GET', '/api/me/path')).body.levels[8].status, 'done');
    // Already cooked: skipping changes nothing.
    assert.equal((await call('POST', '/api/me/levels/9/skip')).body.status, 'done');

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

  test('cooking a recipe again is logged but earns no XP and no streak credit', async () => {
    const again = await call('POST', '/api/me/recipes/pizza-twists/cooked', { body: {} });
    assert.equal(again.status, 201);
    assert.equal(again.body.countsForStreak, false);
    assert.deepEqual([again.body.xpAwarded, again.body.totalXp], [0, 775]);
    assert.deepEqual([again.body.streak.current, again.body.streak.thisWeek.projects], [3, 1]);
    assert.equal((await call('DELETE', `/api/me/cooked/${again.body.entry.id}`)).status, 204);
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
    const foreign = await call('POST', '/api/me/recipes/pizza-twists/cooked', { body: { skills: ['heat-control'] } });
    assert.deepEqual([foreign.status, foreign.body.error.code], [422, 'skill_not_in_recipe']);
    assert.equal((await call('POST', '/api/me/recipes/pizza-twists/cooked', { body: { skills: ['juggling'] } })).status, 400);
    assert.equal((await call('POST', '/api/me/recipes/pizza-twists/cooked', { body: { skills: 'safe-cuts' } })).status, 400);
    assert.equal((await call('GET', '/api/me/recipe-book')).body.recipes[0].timesCooked, 2);
  });

  test('"tried for real" comes only from real cooks', async () => {
    assert.equal((await call('PUT', '/api/me/skills/7/tried-for-real')).status, 404);
  });
});

describe('editing the profile', () => {
  test('name and settings', async () => {
    const before = await call('GET', '/api/me/settings');
    assert.deepEqual(Object.keys(before.body).sort(), ['avatarPreset', 'avatarUrl', 'displayName', 'equipment', 'language', 'sound', 'timezone', 'units', 'vibration']);
    assert.equal((await call('PATCH', '/api/me/settings', { body: { displayName: '' } })).status, 400);
    assert.equal((await call('PATCH', '/api/me/settings', { body: { displayName: 'Alexandra Rose' } })).status, 400);
    assert.equal((await call('PATCH', '/api/me/settings', { body: { displayName: 'Alexandra Ros' } })).status, 200);
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

  test('units, sound, vibration and kitchen tools', async () => {
    const res = await call('PATCH', '/api/me/settings', { body: { units: 'us', sound: false, vibration: false, equipment: ['spatula', 'kitchen-scale', 'pan'] } });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.units, res.body.sound, res.body.vibration, res.body.equipment], ['us', false, false, ['kitchen-scale', 'pan', 'spatula']]);
    const back = await call('PATCH', '/api/me/settings', { body: { units: 'metric', sound: true } });
    assert.deepEqual([back.body.units, back.body.sound, back.body.vibration], ['metric', true, false]);

    for (const body of [{ units: 'imperial' }, { sound: 'off' }, { vibration: 0 }, { equipment: ['spoon'] }, { equipment: 'pan' }]) {
      const bad = await call('PATCH', '/api/me/settings', { body });
      assert.deepEqual([bad.status, bad.body.error.code], [400, 'invalid_field'], JSON.stringify(body));
    }
  });

  test('profiles are always private and Holiday Saves are always automatic', async () => {
    const res = await call('PATCH', '/api/me/settings', { body: { visibility: 'friends', holidaySaveMode: 'manual' } });
    assert.equal(res.status, 200);
    assert.equal('visibility' in res.body, false);
    assert.equal('holidaySaveMode' in res.body, false);
    assert.equal((await call('POST', '/api/me/holiday-saves', { body: { weekStart: '2026-10-19' } })).status, 404);
    assert.deepEqual((await call('GET', '/api/me/streak')).body.holidaySaves, { perYear: 4, usedThisYear: 0, left: 4 });
  });
});

describe('a brand-new user', () => {
  let sam = '';

  test('starts at Level 1 with an encouraging empty streak and default settings', async () => {
    const created = await call('POST', '/api/users', { user: null, body: { displayName: 'Sam', timezone: 'Europe/Berlin' } });
    assert.equal(created.status, 201);
    sam = created.body.id;
    const { body } = await call('GET', '/api/me/profile', { user: sam });
    assert.equal(body.stats.xp, 0);
    assert.deepEqual([body.currentLevel.level, body.currentLevel.kind, body.currentLevel.title], [1, 'learn', 'Safe Cuts']);
    assert.equal(body.streak.current, 0);
    assert.equal(body.streak.message, 'Cook a new Sizzlo recipe this week to start a streak.');
    assert.equal(body.achievements.earned, 0);
    const book = await call('GET', '/api/me/recipe-book', { user: sam });
    assert.ok(book.body.recipes.every((r: { status: string }) => r.status === 'locked'));
    const settings = (await call('GET', '/api/me/settings', { user: sam })).body;
    assert.deepEqual([settings.units, settings.sound, settings.vibration], ['metric', true, true]);
    assert.deepEqual(settings.equipment, ['baking-tray', 'hob', 'knife', 'oven', 'pan', 'pot', 'spatula', 'whisk']);
    assert.equal((await call('POST', '/api/users', { user: null, body: { displayName: 'Sam', timezone: 'Mars/Base' } })).status, 400);
  });

  test('Learn, Practice, then a real cook that stamps only the skills used', async () => {
    const learn = await call('POST', '/api/me/levels/1/learn', { user: sam });
    assert.deepEqual([learn.body.xpAwarded, learn.body.newAchievements.map((a: { id: string }) => a.id)], [50, ['first-cut']]);
    assert.equal((await call('POST', '/api/me/levels/2/attempts', { user: sam, body: { stars: 1 } })).body.totalXp, 100);

    const cooked = await call('POST', '/api/me/recipes/pizza-twists/cooked', { user: sam, body: { skills: ['cut-and-twist'] } });
    assert.equal(cooked.status, 201);
    assert.deepEqual([cooked.body.xpAwarded, cooked.body.totalXp, cooked.body.skillsTried], [100, 200, ['cut-and-twist']]);
    const passport = (await call('GET', '/api/me/skill-passport', { user: sam })).body;
    assert.deepEqual(passport.skills.slice(0, 2).map((s: { status: string }) => s.status), ['practiced', 'tried']);
    assert.deepEqual(passport.summary, { understood: 2, practiced: 2, triedForReal: 1, total: 16 });
    assert.equal((await call('GET', '/api/me/profile', { user: sam })).body.currentLevel.level, 4);
  });

  test('unknown routes and methods', async () => {
    assert.equal((await call('GET', '/api/nope')).status, 404);
    assert.equal((await call('DELETE', '/api/me/profile')).status, 405);
    assert.equal((await call('GET', '/api/me/levels/9/skip')).status, 405);
  });
});
