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

// Monday 12 October 2026, 10:00 in Zurich. Tests move the clock on by setting `now`.
const MONDAY = new Date('2026-10-12T08:00:00Z');
const TUESDAY = new Date('2026-10-13T08:00:00Z');
let now = MONDAY;

let base = '';
let mediaDir = '';
let close: () => Promise<void>;

before(async () => {
  mediaDir = mkdtempSync(join(tmpdir(), 'sizzlo-refresh-'));
  const repo = new Repository(openDatabase(':memory:'));
  seedDemoUser(repo, DEFAULT_RULES, MONDAY);
  const service = new ProfileService(repo, new MediaStore(mediaDir), DEFAULT_RULES, { now: () => now });
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

const refreshSkill = (id: string, score: unknown) => call('POST', `/api/me/skills/${id}/refresh`, { body: { score } });

describe('skill refresh (demo user)', () => {
  test('the demo skills fade as designed and the weakest are due', async () => {
    const { status, body } = await call('GET', '/api/me/skills/refresh');
    assert.equal(status, 200);
    assert.deepEqual(
      body.skills.map((s: { id: string; strength: number; state: string; reviews: number }) => `${s.id}:${s.strength}:${s.state}:${s.reviews}`),
      [
        'knife-basics:10:refresh:1', 'safe-cuts:10:refresh:1',
        'pastry-strips:95:fresh:3', 'cut-and-twist:95:fresh:3',
        'heat-control:89:fresh:3', 'perfect-texture:78:fading:2',
        'pasta-know-how:74:fading:1', 'simmer-and-season:74:fading:1',
        'batter-science:63:fading:0', 'flip-master:63:fading:0',
      ],
    );
    assert.deepEqual(body.due, [
      { id: 'knife-basics', name: 'Knife Basics', strength: 10, state: 'refresh', dueOn: '2026-09-10', reviews: 1, lastReviewedOn: '2026-09-03', drill: { level: 2, kind: 'practice', minutes: 2 } },
      { id: 'safe-cuts', name: 'Safe Cuts', strength: 10, state: 'refresh', dueOn: '2026-09-10', reviews: 1, lastReviewedOn: '2026-09-03', drill: { level: 2, kind: 'practice', minutes: 2 } },
    ]);
    // The seeded refresh (Tuesday) and the cook (Wednesday) keep Heat Control ahead of Perfect Texture.
    const heat = body.skills.find((s: { id: string }) => s.id === 'heat-control');
    assert.deepEqual([heat.lastReviewedOn, heat.dueOn], ['2026-10-07', '2026-11-06']);
    assert.deepEqual((await call('GET', '/api/me/profile')).body.refresh, { due: 2, weakest: { id: 'knife-basics', name: 'Knife Basics', strength: 10 } });
    assert.equal((await call('GET', '/api/me/widget')).body.refreshDue, 2);
    assert.equal((await call('GET', '/api/me/skills/refresh', { user: null })).status, 401);
  });

  test('a passed refresh earns 10 XP once per skill and day', async () => {
    now = MONDAY;
    const first = await refreshSkill('knife-basics', 3);
    assert.equal(first.status, 201);
    assert.deepEqual([first.body.xpAwarded, first.body.totalXp], [10, 820]);
    assert.deepEqual(first.body.skill, {
      id: 'knife-basics', name: 'Knife Basics', strength: 100, state: 'fresh', dueOn: '2026-10-26', reviews: 2, lastReviewedOn: '2026-10-12', drill: { level: 2, kind: 'practice', minutes: 2 },
    });
    const again = await refreshSkill('knife-basics', 2);
    assert.deepEqual([again.body.xpAwarded, again.body.totalXp, again.body.skill.reviews], [0, 820, 3]);
    // Another skill the same day earns its own XP.
    assert.deepEqual([(await refreshSkill('safe-cuts', 2)).body.xpAwarded, (await call('GET', '/api/me/profile')).body.stats.xp], [10, 830]);
    assert.deepEqual((await call('GET', '/api/me/profile')).body.refresh, { due: 0, weakest: null });

    now = TUESDAY;
    const nextDay = await refreshSkill('knife-basics', 3);
    assert.deepEqual([nextDay.body.xpAwarded, nextDay.body.totalXp, nextDay.body.skill.reviews, nextDay.body.skill.dueOn], [10, 840, 4, '2026-12-12']);
    const xp = (await call('GET', '/api/me/stats/xp?weeks=2')).body.weeks.map((w: { xp: number }) => w.xp);
    assert.deepEqual(xp, [285, 30]);
  });

  test('a failed refresh starts the intervals over but still counts as a review', async () => {
    now = TUESDAY;
    const failed = await refreshSkill('knife-basics', 1);
    assert.equal(failed.status, 201);
    assert.deepEqual([failed.body.xpAwarded, failed.body.totalXp], [0, 840]);
    assert.deepEqual([failed.body.skill.reviews, failed.body.skill.strength, failed.body.skill.state, failed.body.skill.dueOn], [0, 100, 'fresh', '2026-10-16']);
    // A pass after a fail the same day doesn't earn XP twice for the day, but it counts.
    const back = await refreshSkill('knife-basics', 2);
    assert.deepEqual([back.body.xpAwarded, back.body.skill.reviews], [0, 1]);
  });

  test('replaying the Practice level is a review of its skills', async () => {
    now = TUESDAY;
    assert.equal((await call('POST', '/api/me/levels/7/attempts', { body: { stars: 3 } })).status, 201);
    const byId = Object.fromEntries((await call('GET', '/api/me/skills/refresh')).body.skills.map((s: { id: string }) => [s.id, s]));
    assert.deepEqual([byId['heat-control'].reviews, byId['heat-control'].lastReviewedOn], [4, '2026-10-13']);
    assert.deepEqual([byId['perfect-texture'].reviews, byId['perfect-texture'].strength], [3, 100]);
  });

  test('refreshes never count for the weekly streak', async () => {
    const streak = (await call('GET', '/api/me/streak')).body;
    assert.deepEqual([streak.current, streak.thisWeek.status, streak.thisWeek.projects, streak.atRisk], [2, 'open', 0, true]);
    assert.equal((await call('GET', '/api/me/widget')).body.streak.state, 'at-risk');
  });

  test('unknown skills, skills not started yet and bad scores are refused', async () => {
    const unknown = await refreshSkill('juggling', 3);
    assert.deepEqual([unknown.status, unknown.body.error.code], [404, 'unknown_skill']);
    const early = await refreshSkill('dressing-science', 3);
    assert.deepEqual([early.status, early.body.error.code, early.body.error.message], [409, 'skill_not_started', 'Finish Level 30 to start Dressing Science.']);
    // Learnt but not practised yet still counts as started.
    assert.equal((await refreshSkill('flip-master', 2)).status, 201);
    for (const score of [4, -1, 2.5, '3', null]) {
      const bad = await refreshSkill('knife-basics', score);
      assert.deepEqual([bad.status, bad.body.error.code], [400, 'invalid_field'], String(score));
    }
    assert.equal((await call('POST', '/api/me/skills/knife-basics/refresh', { body: {} })).status, 400);
    assert.equal((await call('GET', '/api/me/skills/knife-basics/refresh')).status, 405);
    assert.equal((await call('POST', '/api/me/skills/knife-basics/refresh', { user: null, body: { score: 3 } })).status, 401);
  });
});
