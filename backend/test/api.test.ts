import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { DEFAULT_RULES } from '../src/config.ts';
import { createApp } from '../src/http/app.ts';
import { DEMO_USER_ID, seedDemoUser } from '../src/seed.ts';
import { ProfileService, widgetMessage } from '../src/service/profileService.ts';
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
    // 800 XP from levels and cooks, 10 from the Heat Control refresh.
    assert.deepEqual(body.stats, { xp: 810, stars: { earned: 10, max: 30 }, levels: { completed: 12, total: 31 }, recipesCooked: 2 });
    assert.deepEqual(body.currentLevel, {
      level: 13,
      kind: 'practice',
      track: 'recipe',
      title: 'Flip Master',
      recipeId: 'fluffy-pancakes',
      lessonId: null,
      recipe: 'Fluffy Pancakes',
      lesson: null,
      skills: [{ id: 'flip-master', name: 'Flip Master', focus: 'Flipping, doneness cues, browning', transfersTo: ['French toast', 'Burger patties', 'Crêpes'] }],
      chapter: { chapter: 2, title: 'Heat Control' },
    });
    assert.deepEqual(body.chapters[0], {
      chapter: 1, title: 'Knife Skills', levels: { from: 1, to: 5, completed: 5, total: 5 }, stars: { earned: 6, max: 6 }, complete: true,
    });
    assert.deepEqual(body.chapters.map((c: { title: string }) => c.title), ['Knife Skills', 'Heat Control', 'Baking Academy', 'Sauces & Grains', 'Plan & Prep']);
    assert.equal(body.streak.current, 2);
    assert.equal(body.streak.message, 'Cook a new recipe this week to make it 3.');
    assert.deepEqual(body.streak.holidaySaves, { perYear: 4, usedThisYear: 0, left: 4 });
    assert.deepEqual([body.achievements.earned, body.achievements.total], [5, 12]);
    assert.deepEqual(body.skillPassport, { understood: 10, practiced: 8, triedForReal: 4, total: 21 });
    assert.deepEqual(body.refresh, { due: 2, weakest: { id: 'knife-basics', name: 'Knife Basics', strength: 10 } });
  });

  test('home-screen widget: streak needs a cook this week, Continue points at Level 13', async () => {
    const { status, body } = await call('GET', '/api/me/widget');
    assert.equal(status, 200);
    assert.deepEqual(body, {
      day: '2026-10-12',
      streak: {
        current: 2,
        state: 'at-risk',
        daysLeft: 7,
        message: 'Cook a new recipe by Sunday to make it 3.',
        weeks: [
          { label: 'W38', status: 'none' },
          { label: 'W39', status: 'none' },
          { label: 'W40', status: 'done' },
          { label: 'W41', status: 'done' },
          { label: 'W42', status: 'open' },
        ],
      },
      continue: { level: 13, kind: 'practice', track: 'recipe', title: 'Flip Master', recipeId: 'fluffy-pancakes', lessonId: null, recipe: 'Fluffy Pancakes', lesson: null },
      refreshDue: 2,
    });
    assert.equal((await call('GET', '/api/me/widget', { user: null })).status, 401);
    assert.equal(widgetMessage('at-risk', 2, 1), 'Last day! Cook a new recipe to make it 3.');
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
    // Learn 50, Practice 50/75/100 by stars, first real cook 100, refresh 10:
    // L1 + L2 3★ · L3 · L4 3★ · – · L5 + L6 + L7 2★ · refresh + L8 + L9 + L10 2★ + L12 · –
    assert.deepEqual(body.weeks.map((w: { label: string; xp: number }) => `${w.label}:${w.xp}`), ['W36:150', 'W37:50', 'W38:100', 'W39:0', 'W40:225', 'W41:285', 'W42:0']);
    assert.equal(body.total, 810);
  });

  test('achievements and skill passport', async () => {
    const ach = await call('GET', '/api/me/achievements');
    const byId = Object.fromEntries(ach.body.achievements.map((a: { id: string }) => [a.id, a]));
    assert.equal(byId['home-baker'].earned, true);
    assert.equal(ach.body.earned, 5);
    assert.deepEqual([byId['heat-hero'].progress, byId['heat-hero'].target], [7, 9]);
    assert.deepEqual([byId['star-collector'].progress, byId['star-collector'].target], [10, 15]);
    assert.deepEqual([byId['everyday-chef'].description, byId['everyday-chef'].target], ['Complete Sauces & Grains and Plan & Prep', 14]);
    assert.deepEqual([byId['hands-on'].progress, byId['hands-on'].earned], [4, false]);
    const passport = await call('GET', '/api/me/skill-passport');
    assert.equal(passport.body.skills.length, 21);
    assert.deepEqual(passport.body.skills[0], {
      id: 'knife-basics',
      name: 'Knife Basics',
      focus: 'Grips, the claw, a steady board, carrying and washing a knife, clean hands',
      transfersTo: ['Veggie prep', 'Herbs', 'Salads'],
      level: 1,
      kind: 'learn',
      chapter: 1,
      track: 'theory',
      lessonId: 'knife-basics',
      lesson: 'Knife Basics',
      recipeId: null,
      recipe: null,
      status: 'practiced',
      understood: true,
      practiced: true,
      triedForReal: false,
      triedAt: null,
      bestStars: 3,
      unlocked: true,
    });
    const pastry = passport.body.skills[2];
    assert.deepEqual(
      [pastry.id, pastry.track, pastry.lessonId, pastry.recipeId, pastry.status, pastry.triedAt],
      ['pastry-strips', 'recipe', null, 'pizza-twists', 'tried', '2026-09-30T17:30:00.000Z'],
    );
    assert.deepEqual(passport.body.skills.slice(8, 10).map((s: { id: string; status: string }) => `${s.id}:${s.status}`), ['batter-science:understood', 'flip-master:understood']);
    assert.deepEqual(passport.body.skills[20], { ...passport.body.skills[20], id: 'dressing-science', status: 'new', bestStars: null, unlocked: false });
  });

  test('the path shows every level with its kind, recipe and status', async () => {
    const { body } = await call('GET', '/api/me/path');
    assert.equal(body.currentLevel, 13);
    assert.equal(body.levels.length, 31);
    assert.equal(body.chapters.length, 5);
    assert.deepEqual(
      body.levels.slice(0, 15).map((l: { level: number; kind: string; status: string }) => `${l.level}:${l.kind}:${l.status}`),
      [
        '1:learn:done', '2:practice:done', '3:learn:done', '4:practice:done', '5:cook:done',
        '6:learn:done', '7:practice:done', '8:cook:done', '9:learn:done', '10:practice:done',
        '11:cook:skipped', '12:learn:done', '13:practice:open', '14:cook:locked', '15:learn:locked',
      ],
    );
    assert.deepEqual(body.levels.slice(0, 5).map((l: { bestStars: number | null }) => l.bestStars), [null, 3, null, 3, null]);
    const cook = body.levels[4];
    assert.deepEqual([cook.title, cook.track, cook.recipeId, cook.skills.map((s: { id: string }) => s.id)], ['Pizza Twists', 'recipe', 'pizza-twists', ['pastry-strips', 'cut-and-twist']]);
    assert.deepEqual(cook.skills[1].transfersTo, ['Hand pies', 'Cheese straws', 'Cookies']);
  });

  test('the path starts with a theory lesson that belongs to no recipe', async () => {
    const { body } = await call('GET', '/api/me/path');
    assert.deepEqual(
      body.levels.slice(0, 3).map((l: { level: number; kind: string; track: string; title: string; lessonId: string | null; recipeId: string | null }) =>
        [l.level, l.kind, l.track, l.title, l.lessonId, l.recipeId]),
      [
        [1, 'learn', 'theory', 'Knife Basics', 'knife-basics', null],
        [2, 'practice', 'theory', 'Safe Cuts', 'knife-basics', null],
        [3, 'learn', 'recipe', 'Pastry Strips', null, 'pizza-twists'],
      ],
    );
    assert.deepEqual([body.levels[0].recipe, body.levels[0].lesson, body.levels[0].recipeStatus, body.levels[1].bestStars], [null, 'Knife Basics', null, 3]);
  });

  test('the curriculum lists 31 levels with kinds, skills and the theory lessons', async () => {
    const { body } = await call('GET', '/api/curriculum', { user: null });
    assert.deepEqual([body.chapters.length, body.levels.length, body.recipes.length, body.lessons.length], [5, 31, 10, 1]);
    assert.deepEqual(body.levels.slice(16, 20).map((l: { level: number; kind: string; access: string; recipeId: string }) => [l.level, l.kind, l.access, l.recipeId]), [
      [17, 'cook', 'free', 'blueberry-vanilla-muffins'],
      [18, 'learn', 'plus', 'mac-and-cheese'],
      [19, 'practice', 'plus', 'mac-and-cheese'],
      [20, 'cook', 'plus', 'mac-and-cheese'],
    ]);
    const byId = Object.fromEntries(body.recipes.map((r: { id: string }) => [r.id, r]));
    assert.deepEqual(byId['fluffy-pancakes'].levels, { learn: 12, practice: 13, cook: 14 });
    assert.deepEqual([byId['caesar-salad'].levels, byId['caesar-salad'].skills.length, byId['caesar-salad'].uses], [{ learn: 30, practice: null, cook: 31 }, 1, ['knife-basics']]);
    assert.equal(byId['smash-burger-tacos'], undefined);
    assert.deepEqual(body.lessons[0], {
      id: 'knife-basics',
      name: 'Knife Basics',
      access: 'free',
      skills: body.lessons[0].skills,
      levels: { learn: 1, practice: 2 },
      usedIn: ['pizza-twists', 'egg-master-omelette', 'pasta-pomodoro', 'rainbow-crunch-bowl', 'crispy-wrap', 'caesar-salad'],
    });
    assert.deepEqual(body.lessons[0].skills.map((s: { id: string }) => s.id), ['knife-basics', 'safe-cuts']);
    assert.ok(body.levels.every((l: { skills: { transfersTo: string[] }[] }) => l.skills.every((s) => s.transfersTo.length > 0)));
  });
});

describe('recipe book', () => {
  test('lists cooked, ready and locked recipes', async () => {
    const { body } = await call('GET', '/api/me/recipe-book');
    const byId = Object.fromEntries(body.recipes.map((r: { id: string }) => [r.id, r]));
    assert.equal(body.recipes.length, 10);
    assert.deepEqual([byId['pizza-twists'].status, byId['pizza-twists'].timesCooked], ['cooked', 2]);
    assert.deepEqual([byId['egg-master-omelette'].status, byId['egg-master-omelette'].timesCooked], ['cooked', 1]);
    assert.deepEqual([byId['pizza-twists'].countsForStreak, byId['fluffy-pancakes'].countsForStreak], [false, true]);
    // Its Cook level was skipped: it can be cooked any time.
    assert.deepEqual([byId['pasta-pomodoro'].status, byId['pasta-pomodoro'].cookLevel], ['ready', { level: 11, status: 'skipped' }]);
    assert.equal(byId['fluffy-pancakes'].status, 'locked');
    assert.deepEqual(byId['fluffy-pancakes'].levels, { from: 12, to: 14, done: 1, total: 3 });
    assert.deepEqual(byId['fluffy-pancakes'].cookLevel, { level: 14, status: 'locked' });
    assert.deepEqual(byId['pizza-twists'].cookLevel, { level: 5, status: 'done' });
    assert.deepEqual(byId['caesar-salad'].levels, { from: 30, to: 31, done: 0, total: 2 });
    assert.deepEqual(byId['pizza-twists'].uses, ['knife-basics']);
    assert.deepEqual(
      body.recipes.filter((r: { status: string }) => r.status === 'locked').map((r: { id: string }) => r.id),
      ['fluffy-pancakes', 'blueberry-vanilla-muffins', 'mac-and-cheese', 'fluffy-rice', 'rainbow-crunch-bowl', 'crispy-wrap', 'caesar-salad'],
    );
    assert.equal(byId['pizza-twists'].photoUrl, null);
    assert.equal(body.planned.length, 2);
  });

  test('real cooking only counts for unlocked Sizzlo recipes', async () => {
    const locked = await call('POST', '/api/me/recipes/fluffy-rice/cooked', { body: {} });
    assert.equal(locked.status, 409);
    assert.deepEqual([locked.body.error.code, locked.body.error.message], ['recipe_locked', 'Finish Levels 21–22 to cook Perfect Fluffy Rice for real.']);
    assert.equal((await call('POST', '/api/me/recipes/banana-bread/cooked', { body: {} })).status, 404);
    // Smash Burger Tacos left the path.
    assert.equal((await call('POST', '/api/me/recipes/smash-burger-tacos/cooked', { body: {} })).status, 404);
    assert.equal((await call('POST', '/api/me/cook-logs', { body: { kind: 'cook', title: 'Anything' } })).status, 404);
  });
});

describe('levels: Learn, Practice, Cook', () => {
  test('each action only works on its own kind of level', async () => {
    const wrong = await call('POST', '/api/me/levels/13/learn');
    assert.deepEqual([wrong.status, wrong.body.error.code], [400, 'wrong_level_kind']);
    // Stars only exist on Practice levels.
    assert.equal((await call('POST', '/api/me/levels/12/attempts', { body: { stars: 3 } })).body.error.code, 'wrong_level_kind');
    assert.equal((await call('POST', '/api/me/levels/11/attempts', { body: { stars: 3 } })).body.error.code, 'wrong_level_kind');
    assert.equal((await call('POST', '/api/me/levels/16/attempts', { body: { stars: 3 } })).body.error.code, 'level_locked');
    assert.equal((await call('POST', '/api/me/levels/32/attempts', { body: { stars: 3 } })).status, 404);
    assert.equal((await call('POST', '/api/me/levels/13/attempts', { body: { stars: 4 } })).status, 400);
  });

  test('only an unlocked Cook level can be skipped', async () => {
    assert.deepEqual((await call('POST', '/api/me/levels/13/skip')).body.error.code, 'wrong_level_kind');
    assert.deepEqual((await call('POST', '/api/me/levels/12/skip')).status, 400);
    // A theory lesson has no Cook level to skip.
    assert.deepEqual((await call('POST', '/api/me/levels/2/skip')).body.error.code, 'wrong_level_kind');
    const locked = await call('POST', '/api/me/levels/14/skip');
    assert.deepEqual([locked.status, locked.body.error.code], [409, 'level_locked']);
    assert.equal((await call('POST', '/api/me/levels/32/skip')).status, 404);
    assert.equal((await call('POST', '/api/me/levels/15/learn')).body.error.code, 'level_locked');
  });

  test('best stars stay, replays add only the XP difference, Practice opens the Cook level', async () => {
    const first = await call('POST', '/api/me/levels/13/attempts', { body: { stars: 2 } });
    assert.equal(first.status, 201);
    assert.deepEqual([first.body.xpAwarded, first.body.totalXp], [75, 885]);
    assert.deepEqual(first.body.recipeReady, { id: 'fluffy-pancakes', name: 'Fluffy Pancakes', cookLevel: 14 });

    const better = await call('POST', '/api/me/levels/13/attempts', { body: { stars: 3 } });
    assert.deepEqual([better.body.xpAwarded, better.body.bestStars, better.body.totalXp], [25, 3, 910]);
    const worse = await call('POST', '/api/me/levels/13/attempts', { body: { stars: 1 } });
    assert.deepEqual([worse.body.xpAwarded, worse.body.bestStars], [0, 3]);
  });

  test('skipping the Cook level opens the next recipe', async () => {
    const skipped = await call('POST', '/api/me/levels/14/skip');
    assert.equal(skipped.status, 200);
    assert.deepEqual([skipped.body.level, skipped.body.status], [14, 'skipped']);
    assert.deepEqual(skipped.body.nextLevel, { level: 15, kind: 'learn', track: 'recipe', title: 'Measure Like a Chef', recipeId: 'blueberry-vanilla-muffins', lessonId: null });
    // The skip passed the last level of Heat Control.
    assert.deepEqual(skipped.body.newAchievements.map((a: { id: string }) => a.id), ['heat-hero']);
    assert.equal((await call('POST', '/api/me/levels/14/skip')).body.status, 'skipped');

    const learn = await call('POST', '/api/me/levels/15/learn');
    assert.deepEqual([learn.status, learn.body.xpAwarded, learn.body.totalXp, learn.body.recipeReady], [200, 50, 960, null]);
    assert.equal((await call('POST', '/api/me/levels/15/learn')).body.xpAwarded, 0);

    const path = (await call('GET', '/api/me/path')).body;
    assert.deepEqual(path.levels.slice(13, 16).map((l: { status: string }) => l.status), ['skipped', 'done', 'open']);
    assert.equal(path.currentLevel, 16);
    const book = await call('GET', '/api/me/recipe-book');
    const pancakes = book.body.recipes.find((r: { id: string }) => r.id === 'fluffy-pancakes');
    assert.deepEqual([pancakes.status, pancakes.cookLevel], ['ready', { level: 14, status: 'skipped' }]);
  });

  test('cooking the skipped pancakes completes the level, marks the skills tried and extends the streak', async () => {
    const res = await call('POST', '/api/me/recipes/fluffy-pancakes/cooked', { body: {} });
    assert.equal(res.status, 201);
    assert.equal(res.body.entry.recipeName, 'Fluffy Pancakes');
    assert.equal(res.body.entry.cookedOn, '2026-10-12');
    assert.equal(res.body.entry.photoUrl, null);
    assert.deepEqual(res.body.cookLevel, { level: 14, status: 'done' });
    assert.deepEqual([res.body.xpAwarded, res.body.totalXp], [100, 1060]);
    assert.deepEqual(res.body.skillsTried, ['batter-science', 'flip-master']);
    assert.equal(res.body.countsForStreak, true);
    assert.equal(res.body.streak.current, 3);
    assert.equal(res.body.streak.thisWeek.status, 'done');

    const passport = (await call('GET', '/api/me/skill-passport')).body;
    assert.deepEqual(passport.skills.slice(8, 10).map((s: { status: string }) => s.status), ['tried', 'tried']);
    assert.equal(passport.summary.triedForReal, 6);
    assert.equal((await call('GET', '/api/me/path')).body.levels[13].status, 'done');
    // Already cooked: skipping changes nothing.
    assert.equal((await call('POST', '/api/me/levels/14/skip')).body.status, 'done');

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
    assert.deepEqual([again.body.xpAwarded, again.body.totalXp], [0, 1060]);
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

  test('a cook may name the skills of a theory lesson the recipe applies, not others', async () => {
    const cooked = await call('POST', '/api/me/recipes/pizza-twists/cooked', { body: { skills: ['knife-basics', 'cut-and-twist'] } });
    assert.equal(cooked.status, 201);
    assert.deepEqual(cooked.body.skillsTried, ['knife-basics', 'cut-and-twist']);
    const knife = (await call('GET', '/api/me/skill-passport')).body.skills[0];
    assert.deepEqual([knife.id, knife.status, knife.triedForReal], ['knife-basics', 'tried', true]);
    // The cook was a review too: Knife Basics is fresh again, Safe Cuts still needs a refresh.
    const refresh = (await call('GET', '/api/me/skills/refresh')).body;
    assert.deepEqual(refresh.skills.slice(0, 2).map((s: { id: string; strength: number; reviews: number }) => [s.id, s.strength, s.reviews]), [['knife-basics', 100, 2], ['safe-cuts', 10, 1]]);
    assert.deepEqual(refresh.due.map((s: { id: string }) => s.id), ['safe-cuts']);
    assert.equal((await call('DELETE', `/api/me/cooked/${cooked.body.entry.id}`)).status, 204);

    // Fluffy Pancakes applies no theory lesson.
    const foreign = await call('POST', '/api/me/recipes/fluffy-pancakes/cooked', { body: { skills: ['knife-basics'] } });
    assert.deepEqual([foreign.status, foreign.body.error.code], [422, 'skill_not_in_recipe']);
  });

  test('"tried for real" comes only from real cooks', async () => {
    assert.equal((await call('PUT', '/api/me/skills/7/tried-for-real')).status, 404);
  });
});

describe('editing the profile', () => {
  test('name and settings', async () => {
    const before = await call('GET', '/api/me/settings');
    assert.deepEqual(Object.keys(before.body).sort(), ['avatarPreset', 'avatarUrl', 'displayName', 'equipment', 'language', 'timezone', 'units', 'vibration']);
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

  test('units, vibration and kitchen tools; sound is no setting any more', async () => {
    const res = await call('PATCH', '/api/me/settings', { body: { units: 'us', vibration: false, equipment: ['spatula', 'kitchen-scale', 'pan'] } });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.units, res.body.vibration, res.body.equipment], ['us', false, ['kitchen-scale', 'pan', 'spatula']]);
    const back = await call('PATCH', '/api/me/settings', { body: { units: 'metric', sound: false } });
    assert.deepEqual([back.status, back.body.units, back.body.vibration, 'sound' in back.body], [200, 'metric', false, false]);

    for (const body of [{ units: 'imperial' }, { vibration: 0 }, { equipment: ['spoon'] }, { equipment: 'pan' }]) {
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
    assert.deepEqual(
      [body.currentLevel.level, body.currentLevel.kind, body.currentLevel.track, body.currentLevel.title, body.currentLevel.lessonId, body.currentLevel.recipeId],
      [1, 'learn', 'theory', 'Knife Basics', 'knife-basics', null],
    );
    assert.deepEqual(body.refresh, { due: 0, weakest: null });
    assert.equal(body.streak.current, 0);
    assert.equal(body.streak.message, 'Cook a new Sizzlo recipe this week to start a streak.');
    assert.equal(body.achievements.earned, 0);
    const book = await call('GET', '/api/me/recipe-book', { user: sam });
    assert.ok(book.body.recipes.every((r: { status: string }) => r.status === 'locked'));
    const settings = (await call('GET', '/api/me/settings', { user: sam })).body;
    assert.deepEqual([settings.units, settings.vibration], ['metric', true]);
    const widget = (await call('GET', '/api/me/widget', { user: sam })).body;
    assert.deepEqual([widget.streak.state, widget.streak.current, widget.streak.message], ['new', 0, 'Cook a new recipe to start your streak.']);
    assert.deepEqual([widget.continue.level, widget.continue.title, widget.continue.lesson, widget.continue.recipe, widget.refreshDue], [1, 'Knife Basics', 'Knife Basics', null, 0]);
    assert.deepEqual((await call('GET', '/api/me/skills/refresh', { user: sam })).body, { due: [], skills: [] });
    assert.deepEqual(settings.equipment, ['baking-tray', 'hob', 'knife', 'oven', 'pan', 'pot', 'spatula', 'whisk']);
    assert.equal((await call('POST', '/api/users', { user: null, body: { displayName: 'Sam', timezone: 'Mars/Base' } })).status, 400);
  });

  test('the theory lesson comes first: its Learn and Practice open no recipe', async () => {
    const learn = await call('POST', '/api/me/levels/1/learn', { user: sam });
    assert.deepEqual([learn.body.xpAwarded, learn.body.recipeReady, learn.body.newAchievements.map((a: { id: string }) => a.id)], [50, null, ['first-cut']]);
    const practice = await call('POST', '/api/me/levels/2/attempts', { user: sam, body: { stars: 1 } });
    assert.deepEqual([practice.status, practice.body.totalXp, practice.body.recipeReady], [201, 100, null]);

    const path = (await call('GET', '/api/me/path', { user: sam })).body;
    assert.deepEqual(path.levels.slice(0, 3).map((l: { track: string; status: string }) => `${l.track}:${l.status}`), ['theory:done', 'theory:done', 'recipe:open']);
    const passport = (await call('GET', '/api/me/skill-passport', { user: sam })).body;
    assert.deepEqual(passport.skills.slice(0, 2).map((s: { status: string; lessonId: string }) => `${s.lessonId}:${s.status}`), ['knife-basics:practiced', 'knife-basics:practiced']);
    assert.deepEqual((await call('GET', '/api/me/skills/refresh', { user: sam })).body.skills.map((s: { id: string }) => s.id), ['knife-basics', 'safe-cuts']);
    const early = await call('POST', '/api/me/recipes/pizza-twists/cooked', { user: sam, body: {} });
    assert.deepEqual([early.status, early.body.error.code], [409, 'recipe_locked']);
  });

  test('Learn, Practice, then a real cook that stamps only the skills used', async () => {
    assert.equal((await call('POST', '/api/me/levels/3/learn', { user: sam })).body.totalXp, 150);
    const practice = await call('POST', '/api/me/levels/4/attempts', { user: sam, body: { stars: 1 } });
    assert.deepEqual([practice.body.totalXp, practice.body.recipeReady], [200, { id: 'pizza-twists', name: 'Pizza Twists', cookLevel: 5 }]);

    const cooked = await call('POST', '/api/me/recipes/pizza-twists/cooked', { user: sam, body: { skills: ['cut-and-twist', 'safe-cuts'] } });
    assert.equal(cooked.status, 201);
    assert.deepEqual([cooked.body.xpAwarded, cooked.body.totalXp, cooked.body.skillsTried], [100, 300, ['cut-and-twist', 'safe-cuts']]);
    const passport = (await call('GET', '/api/me/skill-passport', { user: sam })).body;
    assert.deepEqual(passport.skills.slice(0, 4).map((s: { status: string }) => s.status), ['practiced', 'tried', 'practiced', 'tried']);
    assert.deepEqual(passport.summary, { understood: 4, practiced: 4, triedForReal: 2, total: 21 });
    assert.equal((await call('GET', '/api/me/profile', { user: sam })).body.currentLevel.level, 6);
    const widget = (await call('GET', '/api/me/widget', { user: sam })).body;
    assert.deepEqual([widget.streak.state, widget.streak.current, widget.streak.message], ['on-track', 1, 'This week is covered. See you next week!']);
    assert.equal(widget.continue.level, 6);
  });

  test('unknown routes and methods', async () => {
    assert.equal((await call('GET', '/api/nope')).status, 404);
    assert.equal((await call('DELETE', '/api/me/profile')).status, 405);
    assert.equal((await call('GET', '/api/me/levels/14/skip')).status, 405);
  });
});

describe('the whole path, up to Caesar Salad', () => {
  let kim = '';
  const as = (method: string, path: string, body?: unknown) => call(method, path, { user: kim, body });

  test('every level up to 29: Learn, one star, skip the Cook', async () => {
    kim = (await call('POST', '/api/users', { user: null, body: { displayName: 'Kim' } })).body.id;
    for (let level = 1; level <= 29; level++) {
      const { kind } = (await call('GET', '/api/me/path', { user: kim })).body.levels[level - 1];
      const res = kind === 'learn' ? await as('POST', `/api/me/levels/${level}/learn`) : kind === 'practice' ? await as('POST', `/api/me/levels/${level}/attempts`, { stars: 1 }) : await as('POST', `/api/me/levels/${level}/skip`);
      assert.ok(res.status < 300, `level ${level}: ${JSON.stringify(res.body)}`);
    }
    assert.equal((await as('GET', '/api/me/path')).body.currentLevel, 30);
  });

  test('Caesar Salad has two levels: its Cook opens right after the Learn level', async () => {
    const book = (await as('GET', '/api/me/recipe-book')).body.recipes.find((r: { id: string }) => r.id === 'caesar-salad');
    assert.deepEqual([book.status, book.levels, book.cookLevel], ['locked', { from: 30, to: 31, done: 0, total: 2 }, { level: 31, status: 'locked' }]);
    const early = await as('POST', '/api/me/recipes/caesar-salad/cooked', {});
    assert.deepEqual([early.status, early.body.error.message], [409, 'Finish Level 30 to cook Caesar Salad for real.']);

    const learn = await as('POST', '/api/me/levels/30/learn');
    assert.deepEqual(learn.body.recipeReady, { id: 'caesar-salad', name: 'Caesar Salad', cookLevel: 31 });
    assert.equal((await as('POST', '/api/me/levels/31/attempts', { stars: 3 })).body.error.code, 'wrong_level_kind');
    const current = (await as('GET', '/api/me/profile')).body.currentLevel;
    assert.deepEqual([current.level, current.kind, current.title, current.skills.map((s: { id: string }) => s.id)], [31, 'cook', 'Caesar Salad', ['dressing-science']]);

    const cooked = await as('POST', '/api/me/recipes/caesar-salad/cooked', { skills: ['dressing-science', 'knife-basics'] });
    assert.equal(cooked.status, 201);
    assert.deepEqual([cooked.body.cookLevel, cooked.body.skillsTried], [{ level: 31, status: 'done' }, ['dressing-science', 'knife-basics']]);
    const profile = (await as('GET', '/api/me/profile')).body;
    assert.deepEqual([profile.currentLevel, profile.stats.levels], [null, { completed: 31, total: 31 }]);
    const byId = Object.fromEntries((await as('GET', '/api/me/achievements')).body.achievements.map((a: { id: string }) => [a.id, a]));
    assert.deepEqual(['chapter-champ', 'heat-hero', 'baking-grad', 'everyday-chef'].map((id) => byId[id].earned), [true, true, true, true]);
    const caesar = (await as('GET', '/api/me/skill-passport')).body.skills.find((s: { id: string }) => s.id === 'dressing-science');
    assert.deepEqual([caesar.status, caesar.practiced, caesar.bestStars], ['tried', false, null]);
  });
});
