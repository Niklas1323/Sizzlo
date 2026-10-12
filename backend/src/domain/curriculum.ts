export type Access = 'free' | 'plus';

export interface Chapter {
  chapter: number;
  title: string;
  from: number;
  to: number;
}

export interface Level {
  level: number;
  chapter: number;
  skill: string;
  focus: string;
  recipe: string;
  access: Access;
  /** Levels 17–20 use recipes that are only proposed so far. */
  recipeStatus: 'confirmed' | 'proposed';
}

/** The original 20-level main plan (levelplan_hauptversion.csv). */
export const CHAPTERS: readonly Chapter[] = [
  { chapter: 1, title: 'Kitchen Foundations', from: 1, to: 4 },
  { chapter: 2, title: 'Heat & Texture', from: 5, to: 9 },
  { chapter: 3, title: 'Baking Academy', from: 10, to: 13 },
  { chapter: 4, title: 'Everyday Chef', from: 14, to: 20 },
];

export const LEVELS: readonly Level[] = [
  { level: 1, chapter: 1, skill: 'Safe Cuts', focus: 'Knife and tool safety, cut sizes', recipe: 'Pizza Twists', access: 'free', recipeStatus: 'confirmed' },
  { level: 2, chapter: 1, skill: 'Dough Rescue', focus: 'Dough structure, moisture, filling', recipe: 'Pizza Twists', access: 'free', recipeStatus: 'confirmed' },
  { level: 3, chapter: 1, skill: 'Heat Control', focus: 'How heat works, doneness', recipe: 'Egg Master', access: 'free', recipeStatus: 'confirmed' },
  { level: 4, chapter: 1, skill: 'Perfect Texture', focus: 'Doneness, consistency, folding', recipe: 'Egg Master', access: 'free', recipeStatus: 'confirmed' },
  { level: 5, chapter: 2, skill: 'Batter Science', focus: 'Wet and dry ingredients, leavening', recipe: 'Pancake Lab', access: 'free', recipeStatus: 'confirmed' },
  { level: 6, chapter: 2, skill: 'Mix & Measure', focus: 'Batter consistency, dosing, portioning', recipe: 'Pancake Lab', access: 'free', recipeStatus: 'confirmed' },
  { level: 7, chapter: 2, skill: 'Flip Master', focus: 'Flipping, doneness cues, browning', recipe: 'Pancake Lab', access: 'free', recipeStatus: 'confirmed' },
  { level: 8, chapter: 2, skill: 'The Sizzle Effect', focus: 'Searing, browning, hygiene', recipe: 'Smash Burger Tacos', access: 'free', recipeStatus: 'confirmed' },
  { level: 9, chapter: 2, skill: 'Crispy & Juicy', focus: 'Moisture, crispness, combining', recipe: 'Smash Burger Tacos', access: 'free', recipeStatus: 'confirmed' },
  { level: 10, chapter: 3, skill: 'Measure Like a Chef', focus: 'Ratios, weighing', recipe: 'Blueberry Vanilla Muffins', access: 'free', recipeStatus: 'confirmed' },
  { level: 11, chapter: 3, skill: 'Mixing Matters', focus: 'Mixing right, not overmixing', recipe: 'Blueberry Vanilla Muffins', access: 'free', recipeStatus: 'confirmed' },
  { level: 12, chapter: 3, skill: 'Rise & Bake', focus: 'Oven, leavening, even baking', recipe: 'Blueberry Vanilla Muffins', access: 'free', recipeStatus: 'confirmed' },
  { level: 13, chapter: 3, skill: 'Baking Rescue', focus: 'Combining causes of failure and rescuing', recipe: 'Blueberry Vanilla Muffins', access: 'free', recipeStatus: 'confirmed' },
  { level: 14, chapter: 4, skill: 'Pasta Basics', focus: 'Pasta, water, salt, cooking', recipe: 'Mac & Cheese Master', access: 'plus', recipeStatus: 'confirmed' },
  { level: 15, chapter: 4, skill: 'Sauce Science', focus: 'Creamy sauce, binding, consistency', recipe: 'Mac & Cheese Master', access: 'plus', recipeStatus: 'confirmed' },
  { level: 16, chapter: 4, skill: 'Perfect Timing', focus: 'Coordinating pasta and sauce', recipe: 'Mac & Cheese Master', access: 'plus', recipeStatus: 'confirmed' },
  { level: 17, chapter: 4, skill: 'Knife Skills 2.0', focus: 'Prepping vegetables, piece sizes', recipe: 'Rainbow Crunch Bowl', access: 'plus', recipeStatus: 'proposed' },
  { level: 18, chapter: 4, skill: 'Flavor Balance', focus: 'Acid, salt, fat, spices', recipe: 'Rainbow Crunch Bowl', access: 'plus', recipeStatus: 'proposed' },
  { level: 19, chapter: 4, skill: 'Kitchen Organization', focus: 'Mise en place, workflows', recipe: 'Crispy Wrap Challenge', access: 'plus', recipeStatus: 'proposed' },
  { level: 20, chapter: 4, skill: 'Kitchen Multitasking', focus: 'Coordination and priorities', recipe: 'Crispy Wrap Challenge', access: 'plus', recipeStatus: 'proposed' },
];

/** Requested recipes whose place on the path is still open. Never given a level number here. */
export const PLANNED_RECIPES = [
  { recipe: 'French Toast Roll-Ups', access: 'free' as Access, status: 'planned', placement: null },
  { recipe: 'Golden Quesadilla', access: 'plus' as Access, status: 'planned', placement: null },
];

export const LEVEL_COUNT = LEVELS.length;
export const MAX_STARS = LEVEL_COUNT * 3;

export function getLevel(level: number): Level | undefined {
  return LEVELS.find((l) => l.level === level);
}

export function getChapter(chapter: number): Chapter | undefined {
  return CHAPTERS.find((c) => c.chapter === chapter);
}
