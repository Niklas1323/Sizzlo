export type HolidaySaveMode = 'auto' | 'manual';

/**
 * Product rules that are still being tuned. Values marked "proposal" come from
 * the project notes and are not final; keep them here so they change in one place.
 */
export interface Rules {
  /** XP for the best star result of a level (proposal: 50 / 75 / 100). */
  xpByStars: { 1: number; 2: number; 3: number };
  /** Holiday Saves per ISO year. A save protects the weekly streak but never extends it. */
  holidaySavesPerYear: number;
  /** Default for new users. "auto" spends a save on a missed week, "manual" only on weeks the user picked. */
  defaultHolidaySaveMode: HolidaySaveMode;
  /** How many days back a real cook may be recorded. */
  cookLogBackdateDays: number;
  /** Largest accepted photo upload (recipe photos and profile pictures). */
  maxPhotoBytes: number;
  defaultTimezone: string;
}

export const DEFAULT_RULES: Rules = {
  xpByStars: { 1: 50, 2: 75, 3: 100 },
  holidaySavesPerYear: 4,
  defaultHolidaySaveMode: 'auto',
  cookLogBackdateDays: 7,
  maxPhotoBytes: 5 * 1024 * 1024,
  defaultTimezone: 'Europe/Zurich',
};

export const EQUIPMENT = [
  'hob',
  'oven',
  'microwave',
  'air-fryer',
  'pan',
  'pot',
  'knife',
  'whisk',
  'baking-tray',
  'blender',
] as const;

export type Equipment = (typeof EQUIPMENT)[number];

export const LANGUAGES = ['en', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];

export const VISIBILITIES = ['private', 'friends'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
