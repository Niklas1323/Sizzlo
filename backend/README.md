# Sizzlo backend

Backend for the **Profile** area of Sizzlo: XP, best stars, level progress on
the skills-first path, the weekly cooking streak with Holiday Saves,
achievements, the Skill Passport, the skill refresh, Cook for Real with recipe
photos for the Recipe Book, and profile settings including a profile picture.

- Node.js ≥ 22.18, TypeScript run directly by Node (no build step)
- SQLite through the built-in `node:sqlite` module
- No runtime dependencies; `typescript` and `@types/node` are dev-only

```bash
cd backend
npm install        # dev tools only
npm start          # http://localhost:8787, demo user "demo-alex"
npm test           # 89 tests (rules, skill refresh, store, feedback + HTTP API)
npm run typecheck
```

Environment: `PORT` (8787), `DATA_DIR` (`data`: database and photos),
`SEED_DEMO` (`true`), `CORS_ORIGIN` (`*`), `FEEDBACK_WEBHOOK_URL` (unset:
where "Give feedback" messages are sent, see below), `ADMIN_KEY` (unset: turns
on the team's feedback list).

## Rules it enforces

| Topic | Rule |
|---|---|
| Levels | Skills first: 31 levels in 5 chapters, each named after a technique (Knife Skills 1–5, Heat Control 6–14, Baking Academy 15–17, Sauces & Grains 18–26, Plan & Prep 27–31). A chapter can start with a **theory lesson** that belongs to no recipe: a **Learn** and a **Practice** level (`track: "theory"`, Knife Basics at Levels 1–2). Then come the recipe "boss levels" (`track: "recipe"`): **Learn** (video and theory cards for this recipe), **Practice** (3 mini-game scenes) and **Cook** (the real recipe). A recipe that teaches only one skill has no Practice level: Caesar Salad is Learn (30) and Cook (31). 1 theory lesson and 10 recipes. Levels unlock in order. Levels 18–31 are flagged `plus`; there is no payment or subscription logic. |
| Skip | A Cook level is optional: `POST /levels/:level/skip` passes it and opens the next recipe. Only an unlocked Cook level can be skipped. Cooking the recipe later still completes the level and earns its XP. |
| Stars | Only Practice levels have stars, 1–3 each (10 Practice levels, 30 in total). The best result is kept forever and never drops. |
| XP | Learn 50, once. Practice 50 / 75 / 100 for 1 / 2 / 3 stars; a replay only earns the difference to the previous best, so XP can't be farmed. Cook 100 the first time a recipe is cooked for real, nothing for cooking it again. A passed skill refresh 10, at most once per skill and day. All values in `src/config.ts`. |
| Skills | Every Learn and Practice level teaches one skill (21 in total: 2 from the Knife Basics lesson, 19 from recipes). Every skill lists `transfersTo`: other dishes it helps with, because Sizzlo teaches cooking, not single recipes. A recipe lists the theory lessons it applies in `uses` (Knife Basics: Pizza Twists, the Omelette's chives, Pasta Pomodoro, Rainbow Crunch Bowl, Crispy Wrap, Caesar Salad); a lesson lists them in `usedIn`. |
| Weekly streak | A week counts when the user cooked (or baked) a **new Sizzlo recipe for real** that week: only the first cook of each recipe counts. Cooking a recipe again is always allowed and logged, it just earns no streak credit (`countsForStreak` tells the app which case it is). There is no free "I cooked" button; digital practice and skill refreshes never count. The current week can't break a streak until it is over. |
| Cook for Real | Opens with the recipe's Cook level, once the level before it is passed (e.g. Fluffy Pancakes at Level 14; Caesar Salad right after its Learn level). The first cook completes the Cook level. Recording a cook returns where to upload the photo. |
| Recipe Book photos | One photo per cook, private. The Recipe Book shows the latest photo; the app keeps the recipe illustration as a small badge on it, or shows the illustration alone while there is no photo. JPEG, PNG or WebP, up to 5 MB, checked by content. |
| Profile picture | Either an uploaded JPEG, PNG or WebP photo or one of 12 illustrated presets (`hat-toss`, `pancake-flip`, `happy-tomato`, `avocado`, `sunny-egg`, `spoony`, `taco-time`, `berry-muffin`, `broccoli`, `strawberry`, `pizza-slice`, `lemon`). One at a time: uploading a photo clears the preset, picking a preset removes the photo. Name, language, units, vibration and kitchen tools are editable (there is no sound setting). Profiles are always private. |
| Holiday Saves | 4 per ISO year, spent automatically on a missed week while the year still has one. A save protects the streak but never extends it. |
| Skill Passport | Per skill: `new` → `understood` (the Learn level of its lesson or recipe done) → `practiced` (that lesson's or recipe's Practice level has a star; Caesar Salad has none) → `tried` (marked by a real cook; the cook may name the skills used). Each skill says where it is taught: `lessonId` for a theory lesson, `recipeId` for a recipe. |
| Skill refresh | Skills fade a little when unused; a 2-minute drill brings them back. A skill joins once understood; that is its first review moment. Reviews are a Practice result of its lesson or recipe (stars = score), a real cook that marks it (score 3) and a refresh drill (score 0–3). A score of 2 or more is a success; a lower one starts the intervals over but still counts as a review. Interval by successful reviews: 3, 7, 14, 30, 60, then 120 days. Strength = max(10, round(100 × 0.5^(days since the last review / interval))): 100 right after, 50 on the due date, never below 10. `fresh` ≥ 80, `fading` 50–79, `refresh` < 50. The drill is the lesson's or recipe's Practice level, or its Learn level when there is none. See `src/domain/refresh.ts`. |
| Cook dates | Up to 7 days back, never a future day. |
| Feedback | 1–2000 characters, at most 10 messages per user and hour. Always stored first, then posted to `FEEDBACK_WEBHOOK_URL` when it is set; if the webhook fails the message stays stored with `forwardedAt: null`. |
| Streak widget | `on-track` when this week has a new recipe cooked, `at-risk` when a streak needs one before Sunday, `new` without a streak. `daysLeft` counts today (Monday 7, Sunday 1). |

### Decisions on open questions (easy to change)

- **Saves.** There is no setting any more: a missed week always uses a save
  while the year still has one.
- **Cook skills.** A cook may send the skills used (`skills: [id]`): the
  recipe's own and those of the theory lessons it applies (`uses`). Only those
  are marked tried; any other skill is refused with `skill_not_in_recipe`.
  Without the list, the recipe's own skills are marked.
- **Refresh.** Every Practice result counts as a review of both skills of its
  lesson or recipe, with the stars as the score (1 star starts the intervals
  over). Every real cook counts, not only the first, so each cook stores its
  skills (`cook_skills`). Refreshes are kept in `skill_reviews`.
- **Upgrading a database.** Versions 2 and 3 keep their data: progress moves to
  the same recipe's levels on the new path, the Smash Burger Tacos levels are
  dropped (their XP stays), and the demo user is seeded again.
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
| GET | `/api/curriculum` | Chapters, the 31 levels (`kind`, `track`, `recipeId` or `lessonId`, skills with `transfersTo`), theory lessons, recipes (with `uses`), planned recipes |
| POST | `/api/users` | Dev sign-up `{ displayName, timezone? }` → `{ id }` |
| GET | `/api/me/profile` | Everything the Profile screen shows, including `refresh: { due, weakest }` (see below) |
| GET | `/api/me/streak?weeks=8` | Streak, Holiday Saves and the last N weeks |
| GET | `/api/me/stats/xp?weeks=7` | XP per week for the statistics chart |
| GET | `/api/me/achievements` | All achievements with progress |
| GET | `/api/me/widget` | Home-screen widgets: streak (`current`, `state`, `daysLeft`, `message`, last 5 weeks), the level to continue and `refreshDue` (skills due for a drill). Valid for `day`; refresh the widget after it ends |
| POST | `/api/me/feedback` | Give feedback `{ message, screen?, appVersion? }` → `{ id, receivedAt, forwarded }` |
| GET | `/api/admin/feedback?limit=50` | The team's feedback list, newest first. Needs `X-Admin-Key: $ADMIN_KEY`; does not exist while `ADMIN_KEY` is unset |
| GET | `/api/me/path` | Every level with its `track`, status (`locked` / `open` / `done` / `skipped`) and best stars on Practice levels |
| GET | `/api/me/skill-passport` | All 21 skills with their evidence level, `transfersTo` and where they are taught (`lessonId` / `recipeId`) |
| GET | `/api/me/skills/refresh` | `{ due, skills }`: every started skill (`strength`, `state`, `dueOn`, `reviews`, `lastReviewedOn`, `drill: { level, kind, minutes: 2 }`) and up to 3 in the `refresh` state, weakest first |
| POST | `/api/me/skills/:skillId/refresh` | A finished drill `{ score: 0–3 }` → `{ skill, xpAwarded, totalXp }`. 404 `unknown_skill`, 409 `skill_not_started` before its Learn level |
| GET / PATCH | `/api/me/settings` | `displayName` (1–13 characters), `language` (`en`/`de`), `units` (`metric`/`us`), `vibration` (boolean), `timezone`, `avatarPreset` (a preset id or `null`), `equipment[]` (kitchen tools, incl. `spatula` and `kitchen-scale`) |
| PUT / GET / DELETE | `/api/me/avatar` | Profile picture: raw image body with its `Content-Type` |
| GET | `/api/me/recipe-book` | All 10 recipes with `locked` / `ready` / `cooked`, their levels (2 or 3), times cooked, latest photo URL |
| POST | `/api/me/recipes/:recipeId/cooked` | Cook for Real: `{ cookedOn?, note?, skills?: [id] }` → entry, `photoUploadUrl`, updated streak, new achievements |
| GET | `/api/me/cooked?limit=20` | Everything cooked for real, newest first |
| DELETE | `/api/me/cooked/:id` | Remove a cook (and its photo) |
| PUT / GET / DELETE | `/api/me/cooked/:id/photo` | Photo of that cook: raw image body with its `Content-Type` |
| POST | `/api/me/levels/:level/learn` | Learn level finished (Learn levels only) → XP awarded, new achievements, `recipeReady` when this opened Cook for Real (Caesar Salad) |
| POST | `/api/me/levels/:level/attempts` | Practice result `{ stars: 1 \| 2 \| 3 }` (Practice levels only) → XP awarded, best stars, new achievements, `recipeReady` when this opened Cook for Real (never on a theory lesson) |
| POST | `/api/me/levels/:level/skip` | Skip an unlocked Cook level and move on |

### `GET /api/me/profile` (demo user)

```json
{
  "user": { "id": "demo-alex", "displayName": "Alex", "initial": "A", "avatarUrl": null, "avatarPreset": "hat-toss", "language": "en", "memberSince": "2026-08-24", "isDemo": true },
  "stats": { "xp": 810, "stars": { "earned": 10, "max": 30 }, "levels": { "completed": 12, "total": 31 }, "recipesCooked": 2 },
  "currentLevel": { "level": 13, "kind": "practice", "track": "recipe", "title": "Flip Master", "recipeId": "fluffy-pancakes", "lessonId": null, "recipe": "Fluffy Pancakes", "lesson": null, "skills": [{ "id": "flip-master", "name": "Flip Master", "focus": "Flipping, doneness cues, browning", "transfersTo": ["French toast", "Burger patties", "Crêpes"] }], "chapter": { "chapter": 2, "title": "Heat Control" } },
  "chapters": [{ "chapter": 1, "title": "Knife Skills", "levels": { "from": 1, "to": 5, "completed": 5, "total": 5 }, "stars": { "earned": 6, "max": 6 }, "complete": true }],
  "streak": {
    "current": 2, "best": 2, "atRisk": true,
    "thisWeek": { "weekStart": "2026-10-12", "status": "open", "projects": 0 },
    "message": "Cook a new recipe this week to make it 3.",
    "holidaySaves": { "perYear": 4, "usedThisYear": 0, "left": 4 },
    "weeks": [{ "label": "W39", "status": "none" }, { "label": "W40", "status": "done" }, { "label": "W41", "status": "done" }]
  },
  "skillPassport": { "understood": 10, "practiced": 8, "triedForReal": 4, "total": 21 },
  "refresh": { "due": 2, "weakest": { "id": "knife-basics", "name": "Knife Basics", "strength": 10 } },
  "achievements": { "earned": 5, "total": 12, "latest": [] }
}
```

(`chapters`, `weeks` and `latest` are shortened here.)

## Feedback delivery

"Give feedback" must reach a person, so every message is stored in the
`feedback` table and, when `FEEDBACK_WEBHOOK_URL` is set, posted there as JSON:

```json
{ "text": "Sizzlo feedback from Alex (settings · v0.9.0 · en):\nThe omelette level is great!",
  "content": "…same line…",
  "feedback": { "id": "…", "userId": "demo-alex", "displayName": "Alex", "message": "…", "screen": "settings", "appVersion": "0.9.0", "language": "en", "createdAt": "…" } }
```

`text` is what a Slack incoming webhook shows and `content` what a Discord
webhook shows, so either can be pasted in directly; a mail relay or Zapier hook
can read `feedback`. The team can always read everything with
`curl -H "X-Admin-Key: $ADMIN_KEY" http://localhost:8787/api/admin/feedback`.

## Layout

```
src/
  config.ts              rules and allowed values
  domain/                pure logic, no I/O: dates, curriculum, xp, streak, progress, achievements, refresh
  service/profileService.ts   use cases (profile, streak, widget, logging, settings, feedback)
  service/feedback.ts    posts feedback to the team's webhook
  store/                 SQLite schema, repository, photo storage (local disk)
  http/                  HTTP server, routing, validation
  seed.ts                demo profile used by the designs
test/                    domain + API tests (node:test)
```
