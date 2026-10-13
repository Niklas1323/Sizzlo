import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { DEFAULT_RULES } from '../src/config.ts';
import { createApp } from '../src/http/app.ts';
import { DEMO_USER_ID, seedDemoUser } from '../src/seed.ts';
import { webhookSink } from '../src/service/feedback.ts';
import { ProfileService } from '../src/service/profileService.ts';
import { openDatabase } from '../src/store/db.ts';
import { MediaStore } from '../src/store/media.ts';
import { Repository } from '../src/store/repository.ts';

const NOW = new Date('2026-10-12T08:00:00Z');
const mediaDir = mkdtempSync(join(tmpdir(), 'sizzlo-feedback-'));
const servers: Server[] = [];
after(async () => {
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  rmSync(mediaDir, { recursive: true, force: true });
});

const listen = async (server: Server) => {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

/** A stand-in for the team's webhook (Slack, Discord, a mail relay…) that records what it receives. */
async function fakeWebhook(status: number) {
  const received: unknown[] = [];
  const url = await listen(
    createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      received.push(JSON.parse(raw));
      res.statusCode = status;
      res.end();
    }),
  );
  return { url, received };
}

async function startApp(opts: { webhook?: string; adminKey?: string; perHour?: number }) {
  const repo = new Repository(openDatabase(':memory:'));
  seedDemoUser(repo, DEFAULT_RULES, NOW);
  const rules = { ...DEFAULT_RULES, feedbackPerHour: opts.perHour ?? DEFAULT_RULES.feedbackPerHour };
  const service = new ProfileService(repo, new MediaStore(mediaDir), rules, { now: () => NOW }, opts.webhook ? webhookSink(opts.webhook, 2000) : null);
  const base = await listen(createApp({ service, maxPhotoBytes: 1024, adminKey: opts.adminKey }));
  return async (method: string, path: string, o: { body?: unknown; user?: string | null; admin?: string } = {}) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const user = o.user === undefined ? DEMO_USER_ID : o.user;
    if (user) headers['X-User-Id'] = user;
    if (o.admin) headers['X-Admin-Key'] = o.admin;
    const res = await fetch(base + path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
}

describe('give feedback', () => {
  test('is stored, passed on to the team webhook and listed for the team', async () => {
    const hook = await fakeWebhook(200);
    const call = await startApp({ webhook: hook.url, adminKey: 'kitchen-secret' });

    const sent = await call('POST', '/api/me/feedback', { body: { message: '  The omelette level is great!  ', screen: 'settings', appVersion: '0.9.0' } });
    assert.equal(sent.status, 201);
    assert.deepEqual([typeof sent.body.id, sent.body.receivedAt, sent.body.forwarded], ['string', NOW.toISOString(), true]);

    assert.equal(hook.received.length, 1);
    const payload = hook.received[0] as { text: string; content: string; feedback: Record<string, unknown> };
    assert.equal(payload.text, 'Sizzlo feedback from Alex (settings · v0.9.0 · en):\nThe omelette level is great!');
    assert.equal(payload.content, payload.text);
    assert.deepEqual([payload.feedback.userId, payload.feedback.message, payload.feedback.screen], [DEMO_USER_ID, 'The omelette level is great!', 'settings']);

    assert.deepEqual([(await call('GET', '/api/admin/feedback')).status, (await call('GET', '/api/admin/feedback', { admin: 'wrong' })).status], [403, 403]);
    const list = await call('GET', '/api/admin/feedback', { admin: 'kitchen-secret', user: null });
    assert.equal(list.status, 200);
    assert.equal(list.body.entries.length, 1);
    assert.deepEqual([list.body.entries[0].message, list.body.entries[0].displayName, list.body.entries[0].forwardedAt], ['The omelette level is great!', 'Alex', NOW.toISOString()]);
  });

  test('stays stored when the webhook fails', async () => {
    const hook = await fakeWebhook(500);
    const call = await startApp({ webhook: hook.url, adminKey: 'k' });
    const sent = await call('POST', '/api/me/feedback', { body: { message: 'Timer was too quiet' } });
    assert.deepEqual([sent.status, sent.body.forwarded], [201, false]);
    assert.equal(hook.received.length, 1);
    const [entry] = (await call('GET', '/api/admin/feedback', { admin: 'k' })).body.entries;
    assert.deepEqual([entry.message, entry.forwardedAt, entry.screen], ['Timer was too quiet', null, null]);
  });

  test('without a webhook it is stored only, and the team list is off without an admin key', async () => {
    const call = await startApp({});
    const sent = await call('POST', '/api/me/feedback', { body: { message: 'More veggie recipes please' } });
    assert.deepEqual([sent.status, sent.body.forwarded], [201, false]);
    assert.equal((await call('GET', '/api/admin/feedback', { admin: 'anything' })).status, 404);
  });

  test('is validated and limited per hour', async () => {
    const call = await startApp({ perHour: 2 });
    assert.equal((await call('POST', '/api/me/feedback', { body: { message: 'Hi' }, user: null })).status, 401);
    for (const body of [{}, { message: '   ' }, { message: 'x'.repeat(2001) }, { message: 42 }, { message: 'ok', screen: 'x'.repeat(65) }]) {
      assert.equal((await call('POST', '/api/me/feedback', { body })).status, 400, JSON.stringify(body).slice(0, 40));
    }
    assert.equal((await call('POST', '/api/me/feedback', { body: { message: 'x'.repeat(2000) } })).status, 201);
    assert.equal((await call('POST', '/api/me/feedback', { body: { message: 'Second' } })).status, 201);
    const third = await call('POST', '/api/me/feedback', { body: { message: 'Third' } });
    assert.deepEqual([third.status, third.body.error.code], [429, 'too_much_feedback']);
  });
});
