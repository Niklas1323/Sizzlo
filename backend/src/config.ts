/**
 * Product rules that are still being tuned. Values marked "proposal" come from
 * the project notes and are not final; keep them here so they change in one place.
 */
export interface Rules {
  /** XP for finishing a Learn level (video and theory cards). Earned once. */
  xpForLearn: number;
  /** XP for the best star result of a Practice level (proposal: 50 / 75 / 100). */
  xpByStars: { 1: number; 2: number; 3: number };
  /** XP the first time a recipe is cooked for real. Cooking it again earns none. */
  xpForFirstCook: number;
  /** Holiday Saves per ISO year. A missed week spends one automatically; a save protects the weekly streak but never extends it. */
  holidaySavesPerYear: number;
  /** How many days back a real cook may be recorded. */
  cookLogBackdateDays: number;
  /** Longest feedback message, and how many a user may send per hour. */
  feedbackMaxChars: number;
  feedbackPerHour: number;
  /** Largest accepted photo upload (recipe photos and profile pictures). */
  maxPhotoBytes: number;
  defaultTimezone: string;
}

export const DEFAULT_RULES: Rules = {
  xpForLearn: 50,
  xpByStars: { 1: 50, 2: 75, 3: 100 },
  xpForFirstCook: 100,
  holidaySavesPerYear: 4,
  cookLogBackdateDays: 7,
  feedbackMaxChars: 2000,
  feedbackPerHour: 10,
  maxPhotoBytes: 5 * 1024 * 1024,
  defaultTimezone: 'Europe/Zurich',
};

/** Kitchen tools the user can tick in settings. */
export const EQUIPMENT = [
  'hob',
  'oven',
  'microwave',
  'air-fryer',
  'pan',
  'pot',
  'knife',
  'whisk',
  'spatula',
  'baking-tray',
  'kitchen-scale',
  'blender',
] as const;

export type Equipment = (typeof EQUIPMENT)[number];

/** What a new user starts with: enough for every Sizzlo recipe. */
export const DEFAULT_EQUIPMENT: readonly Equipment[] = ['hob', 'oven', 'pan', 'pot', 'knife', 'whisk', 'spatula', 'baking-tray'];

export const LANGUAGES = ['en', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Measurements in recipes: grams and millilitres, or cups and ounces. New users get "metric". */
export const UNITS = ['metric', 'us'] as const;
export type Units = (typeof UNITS)[number];

/** Longest display name, so it fits the profile card and leaderboards. */
export const DISPLAY_NAME_MAX = 13;

/** Illustrated profile pictures to pick instead of uploading a photo. */
export const AVATAR_PRESETS = [
  'hat-toss', 'pancake-flip', 'happy-tomato', 'avocado', 'sunny-egg', 'spoony',
  'taco-time', 'berry-muffin', 'broccoli', 'strawberry', 'pizza-slice', 'lemon',
] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];
