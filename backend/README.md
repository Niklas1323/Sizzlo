# Sizzlo backend

Backend for the **Profile** area of Sizzlo: XP, best stars, level progress,
the weekly cooking streak with Holiday Saves, achievements, the Skill Passport,
Cook for Real with recipe photos for the Recipe Book, and profile settings
including a profile picture.

- Node.js ≥ 22.18, TypeScript run directly by Node (no build step)
- SQLite through the built-in `node:sqlite` module
- No runtime dependencies; `typescript` and `@types/node` are dev-only

```bash
cd backend
npm install        # dev tools only
npm start          # http://localhost:8787, demo user "demo-alex"
npm test           # 42 tests (rules + HTTP API)
npm run typecheck
```

Environment: `PORT` (8787), `DATA_DIR` (`data`: database and photos),
`SEED_DEMO` (`true`), `CORS_ORIGIN` (`*`).

## Rules it enforces

| Topic | Rule |
|---|---|
| Stars | 1–3 per level. The best result is kept forever and never drops. |
| XP | 50 / 75 / 100 for 1 / 2 / 3 stars (proposal, in `src/config.ts`). A replay only earns the difference to the previous best, so XP can't be farmed. |
| Levels | The original 20-level plan, 4 chapters. Levels unlock in order. Levels 14–20 are flagged `plus`; there is no payment or subscription logic. |
| Weekly streak | A week counts when the user cooked (or baked) a **new Sizzlo recipe for real** that week: only the first cook of each recipe counts. Cooking a recipe again is always allowed and logged, it just earns no streak credit (`countsForStreak` tells the app which case it is). There is no free "I cooked" button and digital practice never counts. The current week can't break a streak until it is over. |
| Cook for Real | Opens per recipe once all of its levels are done (e.g. Fluffy Pancakes after Levels 5–7). Recording a cook returns where to upload the photo. |
| Recipe Book photos | One photo per cook, private. The Recipe Book shows the latest photo; the app keeps the recipe illustration as a small badge on it, or shows the illustration alone while there is no photo. JPEG, PNG or WebP, up to 5 MB, checked by content. |
| Profile picture | Either an uploaded JPEG, PNG or WebP photo or one of 12 illustrated presets (`hat-toss`, `pancake-flip`, `happy-tomato`, `avocado`, `sunny-egg`, `spoony`, `taco-time`, `berry-muffin`, `broccoli`, `strawberry`, `pizza-slice`, `lemon`). One at a time: uploading a photo clears the preset, picking a preset removes the photo. Name, language, visibility and equipment are editable. |
| Holiday Saves | 4 per ISO year. A save protects a week without a project but never extends the streak. |
| Skill Passport | Per skill: `new` → `understood` (Learn done) → `practiced` (Practice done) → `tried` (tried for real, self-reported). |
| Cook dates | Up to 7 days back, never a future day. |

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
| GET / PATCH | `/api/me/settings` | `displayName` (1–13 characters), `language` (`en`/`de`), `visibility` (`private`/`friends`), `timezone`, `holidaySaveMode`, `avatarPreset` (a preset id or `null`), `equipment[]` |
| PUT / GET / DELETE | `/api/me/avatar` | Profile picture: raw image body with its `Content-Type` |
| GET | `/api/me/recipe-book` | All 8 recipes with `locked` / `ready` / `cooked`, times cooked, latest photo URL |
| POST | `/api/me/recipes/:recipeId/cooked` | Cook for Real: `{ cookedOn?, note? }` → entry, `photoUploadUrl`, updated streak, new achievements |
| GET | `/api/me/cooked?limit=20` | Everything cooked for real, newest first |
| DELETE | `/api/me/cooked/:id` | Remove a cook (and its photo) |
| PUT / GET / DELETE | `/api/me/cooked/:id/photo` | Photo of that cook: raw image body with its `Content-Type` |
| POST | `/api/me/holiday-saves` | Manual mode: `{ weekStart: "YYYY-MM-DD" (a Monday) }` |
| DELETE | `/api/me/holiday-saves/:weekStart` | Give a picked save back |
| POST | `/api/me/levels/:level/learn` | Learn part finished |
| POST | `/api/me/levels/:level/attempts` | Practice result `{ stars: 1 \| 2 \| 3 }` → XP awarded, best stars, new achievements, `recipeReady` when this level opened Cook for Real |
| PUT / DELETE | `/api/me/skills/:level/tried-for-real` | Self-reported "tried for real" |

### `GET /api/me/profile` (demo user)

```json
{
  "user": { "id": "demo-alex", "displayName": "Alex", "initial": "A", "avatarUrl": null, "avatarPreset": "hat-toss", "language": "en", "visibility": "private", "memberSince": "2026-08-24", "isDemo": true },
  "stats": { "xp": 550, "stars": { "earned": 16, "max": 60 }, "levels": { "completed": 6, "total": 20 }, "recipesCooked": 2 },
  "currentLevel": { "level": 7, "skill": "Flip Master", "recipe": "Pancake Lab", "chapter": { "chapter": 2, "title": "Heat & Texture" } },
  "chapters": [{ "chapter": 1, "title": "Kitchen Foundations", "levels": { "from": 1, "to": 4, "completed": 4, "total": 4 }, "stars": { "earned": 11, "max": 12 }, "complete": true }],
  "streak": {
    "current": 2, "best": 2, "atRisk": true,
    "thisWeek": { "weekStart": "2026-10-12", "status": "open", "projects": 0 },
    "message": "Cook a new recipe this week to make it 3.",
    "holidaySaves": { "perYear": 4, "usedThisYear": 0, "left": 4, "mode": "auto" },
    "weeks": [{ "label": "W39", "status": "none" }, { "label": "W40", "status": "done" }, { "label": "W41", "status": "done" }]
  },
  "skillPassport": { "understood": 6, "practiced": 6, "triedForReal": 2, "total": 20 },
  "achievements": { "earned": 5, "total": 12, "latest": [] }
}
```

(`chapters`, `weeks` and `latest` are shortened here.)

## Layout

```
src/
  config.ts              rules and allowed values
  domain/                pure logic, no I/O: dates, curriculum, xp, streak, progress, achievements
  service/profileService.ts   use cases (profile, streak, logging, settings)
  store/                 SQLite schema, repository, photo storage (local disk)
  http/                  HTTP server, routing, validation
  seed.ts                demo profile used by the designs
test/                    domain + API tests (node:test)
```
