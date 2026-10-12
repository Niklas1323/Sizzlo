# Sizzlo backend

Backend for the **Profile** area of Sizzlo: XP, best stars, level progress,
the weekly cooking streak with Holiday Saves, achievements, the Skill Passport,
real cooking logs and profile settings.

- Node.js ≥ 22.18, TypeScript run directly by Node (no build step)
- SQLite through the built-in `node:sqlite` module
- No runtime dependencies; `typescript` and `@types/node` are dev-only

```bash
cd backend
npm install        # dev tools only
npm start          # http://localhost:8787, demo user "demo-alex"
npm test           # 37 tests (rules + HTTP API)
npm run typecheck
```

Environment: `PORT` (8787), `DB_PATH` (`data/sizzlo.db`), `SEED_DEMO` (`true`),
`CORS_ORIGIN` (`*`).

## Rules it enforces

| Topic | Rule |
|---|---|
| Stars | 1–3 per level. The best result is kept forever and never drops. |
| XP | 50 / 75 / 100 for 1 / 2 / 3 stars (proposal, in `src/config.ts`). A replay only earns the difference to the previous best, so XP can't be farmed. |
| Levels | The original 20-level plan, 4 chapters. Levels unlock in order. Levels 14–20 are flagged `plus`; there is no payment or subscription logic. |
| Weekly streak | A week counts when at least one real **cooking or baking** project is logged. Digital practice never counts. The current week can't break a streak until it is over. |
| Holiday Saves | 4 per ISO year. A save protects a week without a project but never extends the streak. |
| Skill Passport | Per skill: `new` → `understood` (Learn done) → `practiced` (Practice done) → `tried` (tried for real, self-reported). |
| Cook logs | Private by default. Can be logged up to 7 days back, never for a future day. No photo upload yet. |

### Decisions on open questions (easy to change)

- **Save mode.** `auto` (default): a missed week uses a save automatically
  while the year still has one. `manual`: only weeks the user picked are
  covered, including last week as a one-week grace. Switching from auto to
  manual keeps the saves already used.
- **Reset.** Saves reset with the ISO year: week 1 starts on the Monday of the
  week with the year's first Thursday.
- **Achievements.** 12 achievements based on learning and real cooking (see
  `src/domain/achievements.ts`). Once earned they stay earned.
- **Auth.** A development stub: requests identify the user with the
  `X-User-Id` header. Replace `ctx.user()` in `src/http/app.ts` with real
  authentication before anything goes public.

## API

All `/api/me/*` routes need `X-User-Id`. Errors look like
`{ "error": { "code": "level_locked", "message": "Finish Level 6 first." } }`.

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/api/curriculum` | Chapters, the 20 levels, planned recipes |
| POST | `/api/users` | Dev sign-up `{ displayName, timezone? }` → `{ id }` |
| GET | `/api/me/profile` | Everything the Profile screen shows (see below) |
| GET | `/api/me/streak?weeks=8` | Streak, Holiday Saves and the last N weeks |
| GET | `/api/me/stats/xp?weeks=7` | XP per week for the statistics chart |
| GET | `/api/me/achievements` | All achievements with progress |
| GET | `/api/me/skill-passport` | All 20 skills with their evidence level |
| GET / PATCH | `/api/me/settings` | `displayName`, `language` (`en`/`de`), `visibility` (`private`/`friends`), `timezone`, `holidaySaveMode`, `equipment[]` |
| GET | `/api/me/cook-logs?limit=20` | Real cooking/baking projects, newest first |
| POST | `/api/me/cook-logs` | `{ kind: "cook" \| "bake", title, note?, recipeId?, cookedOn? }` → log, updated streak, new achievements |
| DELETE | `/api/me/cook-logs/:id` | Remove a project |
| POST | `/api/me/holiday-saves` | Manual mode: `{ weekStart: "YYYY-MM-DD" (a Monday) }` |
| DELETE | `/api/me/holiday-saves/:weekStart` | Give a picked save back |
| POST | `/api/me/levels/:level/learn` | Learn part finished |
| POST | `/api/me/levels/:level/attempts` | Practice result `{ stars: 1 \| 2 \| 3 }` → XP awarded, best stars, new achievements |
| PUT / DELETE | `/api/me/skills/:level/tried-for-real` | Self-reported "tried for real" |

### `GET /api/me/profile` (demo user)

```json
{
  "user": { "id": "demo-alex", "displayName": "Alex", "initial": "A", "language": "en", "visibility": "private", "memberSince": "2026-08-24", "isDemo": true },
  "stats": { "xp": 550, "stars": { "earned": 16, "max": 60 }, "levels": { "completed": 6, "total": 20 } },
  "currentLevel": { "level": 7, "skill": "Flip Master", "recipe": "Pancake Lab", "chapter": { "chapter": 2, "title": "Heat & Texture" } },
  "chapters": [{ "chapter": 1, "title": "Kitchen Foundations", "levels": { "from": 1, "to": 4, "completed": 4, "total": 4 }, "stars": { "earned": 11, "max": 12 }, "complete": true }],
  "streak": {
    "current": 5, "best": 5, "atRisk": true,
    "thisWeek": { "weekStart": "2026-10-12", "status": "open", "projects": 0 },
    "message": "Cook or bake one thing this week to make it 6.",
    "holidaySaves": { "perYear": 4, "usedThisYear": 1, "left": 3, "mode": "auto" },
    "weeks": [{ "label": "W35", "status": "none" }, { "label": "W36", "status": "done" }, { "label": "W37", "status": "saved" }]
  },
  "achievements": { "earned": 6, "total": 12, "latest": [] },
  "skillPassport": { "understood": 6, "practiced": 6, "triedForReal": 2, "total": 20 }
}
```

(`chapters`, `weeks` and `latest` are shortened here.)

## Layout

```
src/
  config.ts              rules and allowed values
  domain/                pure logic, no I/O: dates, curriculum, xp, streak, progress, achievements
  service/profileService.ts   use cases (profile, streak, logging, settings)
  store/                 SQLite schema and repository
  http/                  HTTP server, routing, validation
  seed.ts                demo profile used by the designs
test/                    domain + API tests (node:test)
```
