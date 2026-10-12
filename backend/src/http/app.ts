import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { EQUIPMENT, LANGUAGES, VISIBILITIES } from '../config.ts';
import { CHAPTERS, LEVELS, PLANNED_RECIPES } from '../domain/curriculum.ts';
import { isValidTimeZone } from '../domain/dates.ts';
import type { ProfileService } from '../service/profileService.ts';
import { ServiceError } from '../service/profileService.ts';
import type { User } from '../store/repository.ts';
import { HttpError } from './errors.ts';
import {
  asObject,
  intParam,
  optionalDate,
  optionalEnum,
  optionalString,
  optionalStringList,
  queryInt,
  requiredDate,
  requiredEnum,
  requiredStars,
  requiredString,
} from './validate.ts';

const MAX_BODY_BYTES = 64 * 1024;

interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  /** Resolves the signed-in user; throws 401 when there is none. */
  user: () => User;
}

type Handler = (ctx: Ctx) => unknown;

/** Lets a handler pick the status code; any other return value is sent as 200 JSON. */
class Reply {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body?: unknown) {
    this.status = status;
    this.body = body;
  }
}

const reply = (status: number, body?: unknown) => new Reply(status, body);

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
        keys.push(key);
        return '([^/]+)';
      }) +
      '/?$',
  );
  return { method, pattern, keys, handler };
}

export interface AppOptions {
  service: ProfileService;
  /** Allowed browser origin for the future app frontend. */
  corsOrigin?: string;
}

export function createApp({ service, corsOrigin = '*' }: AppOptions): Server {
  const routes: Route[] = [
    route('GET', '/health', () => ({ ok: true })),

    route('GET', '/api/curriculum', () => ({ chapters: CHAPTERS, levels: LEVELS, plannedRecipes: PLANNED_RECIPES })),

    // Development sign-up. Real authentication replaces this (see README).
    route('POST', '/api/users', (ctx) => {
      const body = asObject(ctx.body);
      const timezone = optionalString(body, 'timezone', { max: 64 });
      if (timezone && !isValidTimeZone(timezone)) throw new HttpError(400, 'invalid_field', 'timezone must be an IANA time zone like Europe/Zurich.');
      const user = service.createUser(requiredString(body, 'displayName', { max: 40 }), timezone);
      return reply(201, { id: user.id, displayName: user.displayName });
    }),

    route('GET', '/api/me/profile', (ctx) => service.profile(ctx.user())),

    route('GET', '/api/me/streak', (ctx) => service.streakView(ctx.user(), queryInt(ctx.query, 'weeks', { min: 1, max: 52, fallback: 8 }))),

    route('GET', '/api/me/stats/xp', (ctx) => service.xpHistory(ctx.user(), queryInt(ctx.query, 'weeks', { min: 1, max: 26, fallback: 7 }))),

    route('GET', '/api/me/achievements', (ctx) => service.achievements(ctx.user())),

    route('GET', '/api/me/skill-passport', (ctx) => service.skillPassport(ctx.user())),

    route('GET', '/api/me/settings', (ctx) => service.settings(ctx.user())),

    route('PATCH', '/api/me/settings', (ctx) => {
      const body = asObject(ctx.body);
      const timezone = optionalString(body, 'timezone', { max: 64 });
      if (timezone && !isValidTimeZone(timezone)) throw new HttpError(400, 'invalid_field', 'timezone must be an IANA time zone like Europe/Zurich.');
      return service.updateSettings(ctx.user(), {
        displayName: optionalString(body, 'displayName', { min: 1, max: 40 }),
        language: optionalEnum(body, 'language', LANGUAGES),
        visibility: optionalEnum(body, 'visibility', VISIBILITIES),
        timezone,
        holidaySaveMode: optionalEnum(body, 'holidaySaveMode', ['auto', 'manual'] as const),
        equipment: optionalStringList(body, 'equipment', EQUIPMENT),
      });
    }),

    route('GET', '/api/me/cook-logs', (ctx) => ({ logs: service.cookLogs(ctx.user(), queryInt(ctx.query, 'limit', { min: 1, max: 100, fallback: 20 })) })),

    route('POST', '/api/me/cook-logs', (ctx) => {
      const body = asObject(ctx.body);
      return reply(
        201,
        service.logCook(ctx.user(), {
          kind: requiredEnum(body, 'kind', ['cook', 'bake'] as const),
          title: requiredString(body, 'title', { max: 80 }),
          note: optionalString(body, 'note', { max: 500 }),
          recipeId: optionalString(body, 'recipeId', { max: 64 }),
          cookedOn: optionalDate(body, 'cookedOn'),
        }),
      );
    }),

    route('DELETE', '/api/me/cook-logs/:id', (ctx) => {
      service.deleteCookLog(ctx.user(), ctx.params.id);
      return reply(204);
    }),

    route('POST', '/api/me/holiday-saves', (ctx) => reply(201, service.addHolidaySave(ctx.user(), requiredDate(asObject(ctx.body), 'weekStart')))),

    route('DELETE', '/api/me/holiday-saves/:weekStart', (ctx) => {
      const weekStart = requiredDate({ weekStart: ctx.params.weekStart }, 'weekStart');
      return service.removeHolidaySave(ctx.user(), weekStart);
    }),

    route('POST', '/api/me/levels/:level/learn', (ctx) => service.completeLearn(ctx.user(), intParam(ctx.params.level, 'level'))),

    route('POST', '/api/me/levels/:level/attempts', (ctx) =>
      reply(201, service.recordAttempt(ctx.user(), intParam(ctx.params.level, 'level'), requiredStars(asObject(ctx.body)))),
    ),

    route('PUT', '/api/me/skills/:level/tried-for-real', (ctx) => service.setTriedForReal(ctx.user(), intParam(ctx.params.level, 'level'), true)),

    route('DELETE', '/api/me/skills/:level/tried-for-real', (ctx) => service.setTriedForReal(ctx.user(), intParam(ctx.params.level, 'level'), false)),
  ];

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.statusCode = status;
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (body === undefined) {
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'OPTIONS') return send(res, 204);

      const match = routes
        .filter((r) => r.pattern.test(url.pathname))
        .map((r) => ({ r, m: r.pattern.exec(url.pathname) as RegExpExecArray }));
      if (match.length === 0) throw new HttpError(404, 'not_found', 'No such endpoint.');
      const hit = match.find(({ r }) => r.method === req.method);
      if (!hit) throw new HttpError(405, 'method_not_allowed', `Use ${match.map(({ r }) => r.method).join(' or ')}.`);

      const params: Record<string, string> = {};
      hit.r.keys.forEach((k, i) => (params[k] = decodeURIComponent(hit.m[i + 1])));

      const ctx: Ctx = {
        params,
        query: url.searchParams,
        body: await readJson(req),
        user: () => {
          const id = req.headers['x-user-id'];
          if (typeof id !== 'string' || id.length === 0) throw new HttpError(401, 'unauthenticated', 'Send the X-User-Id header.');
          return service.requireUser(id);
        },
      };

      const result = hit.r.handler(ctx);
      if (result instanceof Reply) return send(res, result.status, result.body);
      return send(res, 200, result);
    } catch (err) {
      if (err instanceof HttpError || err instanceof ServiceError) {
        return send(res, err.status, { error: { code: err.code, message: err.message } });
      }
      console.error(err);
      return send(res, 500, { error: { code: 'internal', message: 'Something went wrong.' } });
    }
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'DELETE' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Request body is too large.');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
}
