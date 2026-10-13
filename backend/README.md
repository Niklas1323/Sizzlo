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
npm test           # 58 tests (rules, store + HTTP API)
npm run typecheck
```

Environment: `PORT` (8787), `DATA_DIR` (`data`: database and photos),
`SEED_DEMO` (`true`), `CORS_ORIGIN` (`*`).

## Rules it enforces

| Topic | Rule |
|---|---|
| Levels | Every recipe has 3 levels: **Learn** (video and theory cards), **Practice** (3 mini-game scenes) and **Cook** (the real recipe). 8 recipes, 24 levels, 4 chapters. Levels unlock in order. Levels 16–24 are flagged `plus`; there is no payment or subscription logic. |
| Skip | A Cook level is optional: `POST /levels/:level/skip` passes it and opens the next recipe. Only an unlocked Cook level can be skipped. Cooking the recipe later still completes the level and earns its XP. |
| Stars | Only Practice levels have stars, 1–3 each (24 in total). The best result is kept forever and never drops. |
| XP | Learn 50, once. Practice 50 / 75 / 100 for 1 / 2 / 3 stars; a replay only earns the difference to the previous best, so XP can't be farmed. Cook 100 the first time a recipe is cooked for real, nothing for cooking it again. All values in `src/config.ts`. |
| Skills | The Learn and the Practice level of a recipe teach one skill each (16 in total). Every skill lists `transfersTo`: other dishes it helps with, because Sizzlo teaches cooking, not single recipes. |
| Weekly streak | A week counts when the user cooked (or baked) a **new Sizzlo recipe for real** that week: only the first cook of each recipe counts. Cooking a recipe again is always allowed and logged, it just earns no streak credit (`countsForStreak` tells the app which case it is). There is no free "I cooked" button and digital practice never counts. The current week can't break a streak until it is over. |
| Cook for Real | Opens with the recipe's Cook level, once its Learn and Practice level are done (e.g. Fluffy Pancakes at Level 9). The first cook completes the Cook level. Recording a cook returns where to upload the photo. |
| Recipe Book photos | One photo per cook, private. The Recipe Book shows the latest photo; the app keeps the recipe illustration as a small badge on it, or shows the illustration alone while there is no photo. JPEG, PNG or WebP, up to 5 MB, checked by content. |
| Profile picture | Either an uploaded JPEG, PNG or WebP photo or one of 12 illustrated presets (`hat-toss`, `pancake-flip`, `happy-tomato`, `avocado`, `sunny-egg`, `spoony`, `taco-time`, `berry-muffin`, `broccoli`, `strawberry`, `pizza-slice`, `lemon`). One at a time: uploading a photo clears the preset, picking a preset removes the photo. Name, language, units, sound, vibration and kitchen tools are editable. Profiles are always private. |
| Holiday Saves | 4 per ISO year, spent automatically on a missed week while the year still has one. A save protects the streak but never extends it. |
| Skill Passport | Per skill: `new` → `understood` (the recipe's Learn level done) → `practiced` (its Practice level has a star) → `tried` (marked when the recipe is cooked for real; the cook may name the skills used). |
| Cook dates | Up to 7 days back, never a future day. |

### Decisions on open questions (easy to change)

- **Saves.** There is no setting any more: a missed week always uses a save
  while the year still has one.
- **Cook skills.** A cook may send the skills used (`skills: [id]`); only those
  are marked tried. Without the list, both skills of the recipe are marked.
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
| GET | `/api/curriculum` | Chapters, the 24 levels (`kind`, `recipeId`, skills with `transfersTo`), recipes, planned recipes |
| POST | `/api/users` | Dev sign-up `{ displayName, timezone? }` → `{ id }` |
| GET | `/api/me/profile` | Everything the Profile screen shows (see below) |
| GET | `/api/me/streak?weeks=8` | Streak, Holiday Saves and the last N weeks |
| GET | `/api/me/stats/xp?weeks=7` | XP per week for the statistics chart |
| GET | `/api/me/achievements` | All achievements with progress |
| GET | `/api/me/path` | Every level with its status (`locked` / `open` / `done` / `skipped`) and best stars on Practice levels |
| GET | `/api/me/skill-passport` | All 16 skills with their evidence level and `transfersTo` |
| GET / PATCH | `/api/me/settings` | `displayName` (1–13 characters), `language` (`en`/`de`), `units` (`metric`/`us`), `sound`, `vibration` (booleans), `timezone`, `avatarPreset` (a preset id or `null`), `equipment[]` (kitchen tools, incl. `spatula` and `kitchen-scale`) |
| PUT / GET / DELETE | `/api/me/avatar` | Profile picture: raw image body with its `Content-Type` |
| GET | `/api/me/recipe-book` | All 8 recipes with `locked` / `ready` / `cooked`, times cooked, latest photo URL |
| POST | `/api/me/recipes/:recipeId/cooked` | Cook for Real: `{ cookedOn?, note?, skills?: [id] }` → entry, `photoUploadUrl`, updated streak, new achievements |
| GET | `/api/me/cooked?limit=20` | Everything cooked for real, newest first |
| DELETE | `/api/me/cooked/:id` | Remove a cook (and its photo) |
| PUT / GET / DELETE | `/api/me/cooked/:id/photo` | Photo of that cook: raw image body with its `Content-Type` |
| POST | `/api/me/levels/:level/learn` | Learn level finished (Learn levels only) |
| POST | `/api/me/levels/:level/attempts` | Practice result `{ stars: 1 \| 2 \| 3 }` (Practice levels only) → XP awarded, best stars, new achievements, `recipeReady` when this opened Cook for Real |
| POST | `/api/me/levels/:level/skip` | Skip an unlocked Cook level and move on |

### `GET /api/me/profile` (demo user)

```json
{
  "user": { "id": "demo-alex", "displayName": "Alex", "initial": "A", "avatarUrl": null, "avatarPreset": "hat-toss", "language": "en", "memberSince": "2026-08-24", "isDemo": true },
  "stats": { "xp": 525, "stars": { "earned": 5, "max": 24 }, "levels": { "completed": 7, "total": 24 }, "recipesCooked": 2 },
  "currentLevel": { "level": 8, "kind": "practice", "title": "Flip Master", "recipeId": "fluffy-pancakes", "recipe": "Fluffy Pancakes", "skills": [{ "id": "flip-master", "name": "Flip Master", "focus": "Flipping, doneness cues, browning", "transfersTo": ["French toast", "Burger patties", "Crêpes"] }], "chapter": { "chapter": 2, "title": "Heat & Texture" } },
  "chapters": [{ "chapter": 1, "title": "Kitchen Foundations", "levels": { "from": 1, "to": 6, "completed": 6, "total": 6 }, "stars": { "earned": 5, "max": 6 }, "complete": true }],
  "streak": {
    "current": 2, "best": 2, "atRisk": true,
    "thisWeek": { "weekStart": "2026-10-12", "status": "open", "projects": 0 },
    "message": "Cook a new recipe this week to make it 3.",
    "holidaySaves": { "perYear": 4, "usedThisYear": 0, "left": 4 },
    "weeks": [{ "label": "W39", "status": "none" }, { "label": "W40", "status": "done" }, { "label": "W41", "status": "done" }]
  },
  "skillPassport": { "understood": 6, "practiced": 4, "triedForReal": 4, "total": 16 },
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
