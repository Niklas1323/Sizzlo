export type Access = 'free' | 'plus';

/**
 * Lessons and recipes are taught in levels:
 * learn    – video and theory cards
 * practice – three mini-game scenes, 1–3 stars
 * cook     – cook the real recipe; optional, can be skipped
 */
export type LevelKind = 'learn' | 'practice' | 'cook';

/**
 * theory – a general lesson, not tied to one recipe: Learn and Practice
 * recipe – a recipe "boss level": Learn, Practice and Cook
 */
export type Track = 'theory' | 'recipe';

export interface Chapter {
  chapter: number;
  title: string;
  from: number;
  to: number;
}

export interface Skill {
  id: string;
  name: string;
  focus: string;
  /** Other dishes the skill helps with. Sizzlo teaches cooking; the recipe is only the project. */
  transfersTo: readonly string[];
}

/** A theory lesson: a technique the recipes after it apply, such as Knife Basics. It has no Cook level. */
export interface Lesson {
  id: string;
  name: string;
  access: Access;
  /** Its Learn and Practice level. */
  levels: { learn: number; practice: number };
  /** The skills its Learn and Practice level teach, in that order. */
  skills: readonly [Skill, Skill];
  /** The recipes that apply it (their `uses`). */
  usedIn: readonly string[];
}

export interface Recipe {
  id: string;
  name: string;
  /** Baking counts for the streak exactly like cooking; the kind only feeds achievements. */
  kind: 'cook' | 'bake';
  access: Access;
  /** Proposed recipes are not final yet. */
  recipeStatus: 'confirmed' | 'proposed';
  /**
   * Its Learn, Practice and Cook level. A recipe that teaches only one skill has
   * no Practice level. Cook for Real opens with the Cook level.
   */
  levels: { learn: number; practice: number | null; cook: number };
  /** The skills its Learn and Practice level teach, in that order: two, or one without a Practice level. */
  skills: readonly [Skill] | readonly [Skill, Skill];
  /** The theory lessons it applies. A real cook may mark their skills too. */
  uses: readonly string[];
}

export interface Level {
  level: number;
  chapter: number;
  kind: LevelKind;
  track: Track;
  /** Learn and Practice levels are named after their skill, the Cook level after the recipe. */
  title: string;
  /** The recipe of a recipe level; null on a theory level. */
  recipeId: string | null;
  recipe: string | null;
  /** The lesson of a theory level; null on a recipe level. */
  lessonId: string | null;
  lesson: string | null;
  /** Learn and Practice teach one skill each; the Cook level puts the recipe's own skills to use. */
  skills: readonly Skill[];
  access: Access;
  /** Null on a theory level: there is no recipe. */
  recipeStatus: 'confirmed' | 'proposed' | null;
}

export const CHAPTERS: readonly Chapter[] = [
  { chapter: 1, title: 'Knife Skills', from: 1, to: 5 },
  { chapter: 2, title: 'Heat Control', from: 6, to: 14 },
  { chapter: 3, title: 'Baking Academy', from: 15, to: 17 },
  { chapter: 4, title: 'Sauces & Grains', from: 18, to: 26 },
  { chapter: 5, title: 'Plan & Prep', from: 27, to: 31 },
];

const skill = (id: string, name: string, focus: string, transfersTo: string[]): Skill => ({ id, name, focus, transfersTo });

type Step = ({ track: 'theory' } & Omit<Lesson, 'levels' | 'usedIn'>) | ({ track: 'recipe' } & Omit<Recipe, 'levels'>);

/**
 * The path in order, skills first: theory lessons and the recipes that apply them.
 * Level numbers are counted from this list, so they are written down nowhere else.
 */
const PLAN: readonly Step[] = [
  {
    track: 'theory', id: 'knife-basics', name: 'Knife Basics', access: 'free',
    skills: [
      skill('knife-basics', 'Knife Basics', 'Grips, the claw, a steady board, carrying and washing a knife, clean hands', ['Veggie prep', 'Herbs', 'Salads']),
      skill('safe-cuts', 'Safe Cuts', 'Claw grip, safe moves, a clean board', ['Veggie prep', 'Herbs', 'Fruit salad']),
    ],
  },
  {
    track: 'recipe', id: 'pizza-twists', name: 'Pizza Twists', kind: 'bake', access: 'free', recipeStatus: 'confirmed', uses: ['knife-basics'],
    skills: [
      skill('pastry-strips', 'Pastry Strips', 'Cold pastry, straight even cuts, layering', ['Cheese straws', 'Hand pies', 'Palmiers']),
      skill('cut-and-twist', 'Cut & Twist', 'Cutting dough into strips, filling and twisting', ['Hand pies', 'Cheese straws', 'Cookies']),
    ],
  },
  {
    // Chives: the knife comes out for the omelette too.
    track: 'recipe', id: 'egg-master-omelette', name: 'Egg Master Omelette', kind: 'cook', access: 'free', recipeStatus: 'confirmed', uses: ['knife-basics'],
    skills: [
      skill('heat-control', 'Heat Control', 'How heat works, doneness', ['Pancakes', 'Fried eggs', 'Grilled cheese']),
      skill('perfect-texture', 'Perfect Texture', 'Doneness, consistency, folding', ['Scrambled eggs', 'Frittata', 'Custard']),
    ],
  },
  {
    track: 'recipe', id: 'pasta-pomodoro', name: 'Pasta Pomodoro', kind: 'cook', access: 'free', recipeStatus: 'proposed', uses: ['knife-basics'],
    skills: [
      skill('pasta-know-how', 'Pasta Know-How', 'Pasta shapes, salted boiling water, al dente', ['Mac & Cheese', 'Pasta salad', 'Lasagne']),
      skill('simmer-and-season', 'Simmer & Season', 'Simmering a sauce, tasting, pasta water', ['Tomato soup', 'Chili', 'Curry']),
    ],
  },
  {
    track: 'recipe', id: 'fluffy-pancakes', name: 'Fluffy Pancakes', kind: 'cook', access: 'free', recipeStatus: 'confirmed', uses: [],
    skills: [
      skill('batter-science', 'Batter Science', 'Wet and dry ingredients, leavening', ['Muffins', 'Crêpes', 'Waffles']),
      skill('flip-master', 'Flip Master', 'Flipping, doneness cues, browning', ['French toast', 'Burger patties', 'Crêpes']),
    ],
  },
  {
    track: 'recipe', id: 'blueberry-vanilla-muffins', name: 'Blueberry Vanilla Muffins', kind: 'bake', access: 'free', recipeStatus: 'confirmed', uses: [],
    skills: [
      skill('measure-like-a-chef', 'Measure Like a Chef', 'Ratios, weighing', ['Banana bread', 'Shortbread', 'Bread dough']),
      skill('mixing-matters', 'Mixing Matters', 'Mixing right, not overmixing', ['Brownies', 'Sponge cake', 'Scones']),
    ],
  },
  {
    track: 'recipe', id: 'mac-and-cheese', name: 'Mac & Cheese', kind: 'cook', access: 'plus', recipeStatus: 'confirmed', uses: [],
    skills: [
      skill('sauce-science', 'Sauce Science', 'Creamy sauce, binding, consistency', ['Lasagne', 'Gravy', 'Creamy soups']),
      skill('perfect-timing', 'Perfect Timing', 'Coordinating pasta and sauce', ['Spaghetti bolognese', 'Curry and rice', 'Sunday roast']),
    ],
  },
  {
    track: 'recipe', id: 'fluffy-rice', name: 'Perfect Fluffy Rice', kind: 'cook', access: 'plus', recipeStatus: 'proposed', uses: [],
    skills: [
      skill('rice-ratio', 'Rice Ratio', 'Rinsing, water ratio, the absorption method', ['Rice bowls', 'Fried rice', 'Couscous']),
      skill('steam-and-rest', 'Steam & Rest', 'Low heat, lid on, resting', ['Quinoa', 'Pilaf', 'Risotto']),
    ],
  },
  {
    track: 'recipe', id: 'rainbow-crunch-bowl', name: 'Rainbow Crunch Bowl', kind: 'cook', access: 'plus', recipeStatus: 'proposed', uses: ['knife-basics'],
    skills: [
      skill('knife-skills-2', 'Knife Skills 2.0', 'Prepping vegetables, piece sizes', ['Salsa', 'Coleslaw', 'Stir-fry']),
      skill('flavor-balance', 'Flavor Balance', 'Acid, salt, fat, spices', ['Salad dressing', 'Soups', 'Curry']),
    ],
  },
  {
    track: 'recipe', id: 'crispy-wrap', name: 'Crispy Wrap', kind: 'cook', access: 'plus', recipeStatus: 'proposed', uses: ['knife-basics'],
    skills: [
      skill('kitchen-organization', 'Kitchen Organization', 'Mise en place, workflows', ['Fajitas', 'Meal prep', 'Sheet-pan dinners']),
      skill('kitchen-multitasking', 'Kitchen Multitasking', 'Coordination and priorities', ['Full breakfast', 'Burgers and fries', 'Pasta with garlic bread']),
    ],
  },
  {
    // One skill, so no Practice level: Cook for Real opens right after the Learn level.
    track: 'recipe', id: 'caesar-salad', name: 'Caesar Salad', kind: 'cook', access: 'plus', recipeStatus: 'proposed', uses: ['knife-basics'],
    skills: [skill('dressing-science', 'Dressing Science', 'Emulsions, balance, crisp leaves', ['Vinaigrette', 'Coleslaw', 'Potato salad'])],
  },
];

/** Levels a step takes: one per skill (Learn, then Practice), plus Cook for a recipe. */
const sizeOf = (s: Step) => s.skills.length + (s.track === 'recipe' ? 1 : 0);
/** The Learn level of the i-th step: the plan is numbered in order. */
const learnLevelOf = (i: number) => PLAN.slice(0, i).reduce((n, s) => n + sizeOf(s), 1);

/** The real recipes behind the path. */
export const RECIPES: readonly Recipe[] = PLAN.flatMap((s, i) => {
  if (s.track !== 'recipe') return [];
  const { track, ...recipe } = s;
  const learn = learnLevelOf(i);
  return [{ ...recipe, levels: { learn, practice: s.skills.length === 2 ? learn + 1 : null, cook: learn + s.skills.length } }];
});

/** The theory lessons, each with the recipes that apply it. */
export const LESSONS: readonly Lesson[] = PLAN.flatMap((s, i) => {
  if (s.track !== 'theory') return [];
  const { track, ...lesson } = s;
  const learn = learnLevelOf(i);
  return [{ ...lesson, levels: { learn, practice: learn + 1 }, usedIn: RECIPES.filter((r) => r.uses.includes(s.id)).map((r) => r.id) }];
});

const chapterOf = (level: number) => CHAPTERS.find((c) => level >= c.from && level <= c.to)?.chapter ?? 0;

const theoryLevel = (l: Lesson, n: number, kind: LevelKind, s: Skill): Level => ({
  level: n,
  chapter: chapterOf(n),
  kind,
  track: 'theory',
  title: s.name,
  recipeId: null,
  recipe: null,
  lessonId: l.id,
  lesson: l.name,
  skills: [s],
  access: l.access,
  recipeStatus: null,
});

const recipeLevel = (r: Recipe, n: number, kind: LevelKind, title: string, skills: readonly Skill[]): Level => ({
  level: n,
  chapter: chapterOf(n),
  kind,
  track: 'recipe',
  title,
  recipeId: r.id,
  recipe: r.name,
  lessonId: null,
  lesson: null,
  skills,
  access: r.access,
  recipeStatus: r.recipeStatus,
});

export const LEVELS: readonly Level[] = [
  ...LESSONS.flatMap((l) => [theoryLevel(l, l.levels.learn, 'learn', l.skills[0]), theoryLevel(l, l.levels.practice, 'practice', l.skills[1])]),
  ...RECIPES.flatMap((r) => {
    const [learnt, practised] = r.skills;
    return [
      recipeLevel(r, r.levels.learn, 'learn', learnt.name, [learnt]),
      ...(practised && r.levels.practice !== null ? [recipeLevel(r, r.levels.practice, 'practice', practised.name, [practised])] : []),
      recipeLevel(r, r.levels.cook, 'cook', r.name, r.skills),
    ];
  }),
].sort((a, b) => a.level - b.level);

/** The levels that teach a skill, one each: every Learn and Practice level, in path order. */
export const SKILL_LEVELS: readonly Level[] = LEVELS.filter((l) => l.kind !== 'cook');

export const SKILLS: readonly Skill[] = SKILL_LEVELS.map((l) => l.skills[0]);
export const SKILL_IDS: readonly string[] = SKILLS.map((s) => s.id);

/** Requested recipes whose place on the path is still open. Never given a level number here. */
export const PLANNED_RECIPES = [
  { recipe: 'French Toast Roll-Ups', access: 'free' as Access, status: 'planned', placement: null },
  { recipe: 'Golden Quesadilla', access: 'plus' as Access, status: 'planned', placement: null },
];

export const LEVEL_COUNT = LEVELS.length;
/** Stars exist only on Practice levels. */
export const MAX_STARS = LEVELS.filter((l) => l.kind === 'practice').length * 3;

export function getLevel(level: number): Level | undefined {
  return LEVELS.find((l) => l.level === level);
}

export function getChapter(chapter: number): Chapter | undefined {
  return CHAPTERS.find((c) => c.chapter === chapter);
}

export function getRecipe(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

/** The recipe a level belongs to; undefined on a theory level. */
export function recipeOfLevel(level: number): Recipe | undefined {
  const recipeId = getLevel(level)?.recipeId;
  return recipeId ? getRecipe(recipeId) : undefined;
}

/** The theory lesson or recipe a level belongs to. Both have a Learn and (maybe) a Practice level. */
export function sourceOf(level: Level): Lesson | Recipe {
  return (level.lessonId ? getLesson(level.lessonId) : getRecipe(level.recipeId ?? '')) as Lesson | Recipe;
}

/** The Learn or Practice level that teaches a skill. */
export function levelOfSkill(skillId: string): Level | undefined {
  return SKILL_LEVELS.find((l) => l.skills[0].id === skillId);
}

/** The skills a real cook of the recipe may mark: its own and those of the lessons it applies. */
export function cookableSkills(recipe: Recipe): readonly Skill[] {
  return [...recipe.skills, ...recipe.uses.flatMap((id) => getLesson(id)?.skills ?? [])];
}

/** The level numbers of a recipe, in order: two or three. */
export function recipeLevelNumbers(recipe: Recipe): number[] {
  const { learn, practice, cook } = recipe.levels;
  return practice === null ? [learn, cook] : [learn, practice, cook];
}
