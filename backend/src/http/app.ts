import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { AVATAR_PRESETS, DISPLAY_NAME_MAX, EQUIPMENT, LANGUAGES, UNITS } from '../config.ts';
import { CHAPTERS, LESSONS, LEVELS, PLANNED_RECIPES, RECIPES, SKILL_IDS } from '../domain/curriculum.ts';
import { isValidTimeZone } from '../domain/dates.ts';
import type { Image, ProfileService } from '../service/profileService.ts';
import { ServiceError } from '../service/profileService.ts';
import { IMAGE_TYPES, sniffImageType } from '../store/media.ts';
import type { ImageType } from '../store/media.ts';
import type { User } from '../store/repository.ts';
import { HttpError } from './errors.ts';
import {
  asObject,
  intParam,
  nullableEnum,
  optionalBoolean,
  optionalDate,
  optionalEnum,
  optionalString,
  optionalStringList,
  queryInt,
  requiredScore,
  requiredStars,
  requiredString,
} from './validate.ts';

const MAX_JSON_BYTES = 64 * 1024;

interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parses the body as a JSON object. */
  json: () => Promise<ReturnType<typeof asObject>>;
  /** Reads the body as an uploaded image (raw bytes, Content-Type image/jpeg, png or webp). */
  image: () => Promise<Image>;
  /** Resolves the signed-in user; throws 401 when there is none. */
  user: () => User;
  /** Checks the X-Admin-Key header; 404 while no admin key is configured, 403 when it doesn't match. */
  admin: () => void;
}

type Handler = (ctx: Ctx) => unknown;

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

/** Sends raw image bytes instead of JSON. */
class ImageReply {
  readonly image: Image;

  constructor(image: Image) {
    this.image = image;
  }
}

export interface AppOptions {
  service: ProfileService;
  maxPhotoBytes: number;
  /** Allowed browser origin for the future app frontend. */
  corsOrigin?: string;
  /** Unlocks GET /api/admin/feedback (header X-Admin-Key). Without it the route doesn't exist. */
  adminKey?: string;
  /** Longest feedback message. */
  feedbackMaxChars?: number;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

export function createApp({ service, maxPhotoBytes, corsOrigin = '*', adminKey, feedbackMaxChars = 2000 }: AppOptions): Server {
  const timezoneField = (body: Record<string, unknown>) => {
    const timezone = optionalString(body, 'timezone', { max: 64 });
    if (timezone && !isValidTimeZone(timezone)) throw new HttpError(400, 'invalid_field', 'timezone must be an IANA time zone like Europe/Zurich.');
    return timezone;
  };

  const routes: Route[] = [
    route('GET', '/health', () => ({ ok: true })),

    route('GET', '/api/curriculum', () => ({ chapters: CHAPTERS, levels: LEVELS, lessons: LESSONS, recipes: RECIPES, plannedRecipes: PLANNED_RECIPES })),

    // Development sign-up. Real authentication replaces this (see README).
    route('POST', '/api/users', async (ctx) => {
      const body = await ctx.json();
      const user = service.createUser(requiredString(body, 'displayName', { max: DISPLAY_NAME_MAX }), timezoneField(body));
      return reply(201, { id: user.id, displayName: user.displayName });
    }),

    // Profile screen
    route('GET', '/api/me/profile', (ctx) => service.profile(ctx.user())),
    route('GET', '/api/me/streak', (ctx) => service.streakView(ctx.user(), queryInt(ctx.query, 'weeks', { min: 1, max: 52, fallback: 8 }))),
    route('GET', '/api/me/stats/xp', (ctx) => service.xpHistory(ctx.user(), queryInt(ctx.query, 'weeks', { min: 1, max: 26, fallback: 7 }))),
    route('GET', '/api/me/achievements', (ctx) => service.achievements(ctx.user())),
    route('GET', '/api/me/skill-passport', (ctx) => service.skillPassport(ctx.user())),
    route('GET', '/api/me/path', (ctx) => service.path(ctx.user())),

    // Skill refresh: skills fade a little when unused, a 2-minute drill brings them back.
    route('GET', '/api/me/skills/refresh', (ctx) => service.refresh(ctx.user())),
    route('POST', '/api/me/skills/:skillId/refresh', async (ctx) =>
      reply(201, service.refreshSkill(ctx.user(), ctx.params.skillId, requiredScore(await ctx.json()))),
    ),

    // Home-screen widgets: the weekly streak and Continue.
    route('GET', '/api/me/widget', (ctx) => service.widget(ctx.user())),

    // "Give feedback" in settings. Stored, and passed on to the team's webhook when one is set.
    route('POST', '/api/me/feedback', async (ctx) => {
      const user = ctx.user();
      const body = await ctx.json();
      return reply(
        201,
        await service.sendFeedback(user, {
          message: requiredString(body, 'message', { max: feedbackMaxChars }),
          screen: optionalString(body, 'screen', { max: 64 }),
          appVersion: optionalString(body, 'appVersion', { max: 32 }),
        }),
      );
    }),
    route('GET', '/api/admin/feedback', (ctx) => {
      ctx.admin();
      return service.feedbackList(queryInt(ctx.query, 'limit', { min: 1, max: 500, fallback: 50 }));
    }),

    // Settings and profile picture
    route('GET', '/api/me/settings', (ctx) => service.settings(ctx.user())),
    route('PATCH', '/api/me/settings', async (ctx) => {
      const body = await ctx.json();
      return service.updateSettings(ctx.user(), {
        displayName: optionalString(body, 'displayName', { min: 1, max: DISPLAY_NAME_MAX }),
        language: optionalEnum(body, 'language', LANGUAGES),
        timezone: timezoneField(body),
        units: optionalEnum(body, 'units', UNITS),
        vibration: optionalBoolean(body, 'vibration'),
        avatarPreset: nullableEnum(body, 'avatarPreset', AVATAR_PRESETS),
        equipment: optionalStringList(body, 'equipment', EQUIPMENT),
      });
    }),
    route('PUT', '/api/me/avatar', async (ctx) => service.setAvatar(ctx.user(), await ctx.image())),
    route('GET', '/api/me/avatar', (ctx) => new ImageReply(service.avatar(ctx.user()))),
    route('DELETE', '/api/me/avatar', (ctx) => service.removeAvatar(ctx.user())),

    // Levels: Learn and Practice for each theory lesson and recipe, Cook for each recipe. Cooking itself is recorded on the recipe below.
    route('POST', '/api/me/levels/:level/learn', (ctx) => service.completeLearn(ctx.user(), intParam(ctx.params.level, 'level'))),
    route('POST', '/api/me/levels/:level/attempts', async (ctx) =>
      reply(201, service.recordAttempt(ctx.user(), intParam(ctx.params.level, 'level'), requiredStars(await ctx.json()))),
    ),
    route('POST', '/api/me/levels/:level/skip', (ctx) => service.skipLevel(ctx.user(), intParam(ctx.params.level, 'level'))),

    // Cook for Real and the Recipe Book. A real cook is always a Sizzlo recipe the user unlocked.
    route('GET', '/api/me/recipe-book', (ctx) => service.recipeBook(ctx.user())),
    route('POST', '/api/me/recipes/:recipeId/cooked', async (ctx) => {
      const body = await ctx.json();
      return reply(
        201,
        service.cookRecipe(ctx.user(), ctx.params.recipeId, {
          cookedOn: optionalDate(body, 'cookedOn'),
          note: optionalString(body, 'note', { max: 500 }),
          skills: optionalStringList(body, 'skills', SKILL_IDS),
        }),
      );
    }),
    route('GET', '/api/me/cooked', (ctx) => ({ entries: service.cookedEntries(ctx.user(), queryInt(ctx.query, 'limit', { min: 1, max: 100, fallback: 20 })) })),
    route('DELETE', '/api/me/cooked/:id', (ctx) => {
      service.deleteCooked(ctx.user(), ctx.params.id);
      return reply(204);
    }),
    route('PUT', '/api/me/cooked/:id/photo', async (ctx) => service.setCookedPhoto(ctx.user(), ctx.params.id, await ctx.image())),
    route('GET', '/api/me/cooked/:id/photo', (ctx) => new ImageReply(service.cookedPhoto(ctx.user(), ctx.params.id))),
    route('DELETE', '/api/me/cooked/:id/photo', (ctx) => service.removeCookedPhoto(ctx.user(), ctx.params.id)),
  ];

  const cors = (res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  };

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.statusCode = status;
    cors(res);
    if (body === undefined) {
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };

  const sendImage = (res: ServerResponse, image: Image) => {
    res.statusCode = 200;
    cors(res);
    res.setHeader('Content-Type', image.type);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(image.data);
  };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'OPTIONS') return send(res, 204);

      const candidates = routes.filter((r) => r.pattern.test(url.pathname));
      if (candidates.length === 0) throw new HttpError(404, 'not_found', 'No such endpoint.');
      const hit = candidates.find((r) => r.method === req.method);
      if (!hit) throw new HttpError(405, 'method_not_allowed', `Use ${candidates.map((r) => r.method).join(' or ')}.`);

      const match = hit.pattern.exec(url.pathname) as RegExpExecArray;
      const params: Record<string, string> = {};
      hit.keys.forEach((k, i) => (params[k] = decodeURIComponent(match[i + 1])));

      const ctx: Ctx = {
        params,
        query: url.searchParams,
        json: async () => {
          const raw = await readBody(req, MAX_JSON_BYTES);
          if (raw.length === 0) return {};
          try {
            return asObject(JSON.parse(raw.toString('utf8')));
          } catch (err) {
            if (err instanceof HttpError) throw err;
            throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.');
          }
        },
        image: async () => {
          const declared = String(req.headers['content-type'] ?? '').split(';')[0].trim();
          if (!(IMAGE_TYPES as readonly string[]).includes(declared)) {
            throw new HttpError(415, 'unsupported_image', 'Upload a JPEG, PNG or WebP image as the raw request body.');
          }
          const data = await readBody(req, maxPhotoBytes);
          const actual = sniffImageType(data);
          if (!actual || actual !== (declared as ImageType)) {
            throw new HttpError(415, 'unsupported_image', 'The file is not the image type it claims to be.');
          }
          return { type: actual, data };
        },
        user: () => {
          const id = req.headers['x-user-id'];
          if (typeof id !== 'string' || id.length === 0) throw new HttpError(401, 'unauthenticated', 'Send the X-User-Id header.');
          return service.requireUser(id);
        },
        admin: () => {
          if (!adminKey) throw new HttpError(404, 'not_found', 'No such endpoint.');
          const sent = req.headers['x-admin-key'];
          if (typeof sent !== 'string' || !timingSafeEqual(digest(sent), digest(adminKey))) {
            throw new HttpError(403, 'forbidden', 'Send the right X-Admin-Key header.');
          }
        },
      };

      const result = await hit.handler(ctx);
      if (result instanceof ImageReply) return sendImage(res, result.image);
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

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'too_large', `Request body is larger than ${Math.round(limit / 1024)} KB.`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
