export type Access = 'free' | 'plus';

/**
 * Every recipe is taught in three levels:
 * learn    – video and theory cards
 * practice – three mini-game scenes, 1–3 stars
 * cook     – cook the real recipe; optional, can be skipped
 */
export type LevelKind = 'learn' | 'practice' | 'cook';

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

export interface Recipe {
  id: string;
  name: string;
  /** Baking counts for the streak exactly like cooking; the kind only feeds achievements. */
  kind: 'cook' | 'bake';
  access: Access;
  /** Rainbow Crunch Bowl and Crispy Wrap are only proposed so far. */
  recipeStatus: 'confirmed' | 'proposed';
  /** Its Learn, Practice and Cook level. Cook for Real opens once Learn and Practice are done. */
  levels: { learn: number; practice: number; cook: number };
  /** The skills its Learn and Practice level teach, in that order. */
  skills: readonly [Skill, Skill];
}

export interface Level {
  level: number;
  chapter: number;
  kind: LevelKind;
  /** Learn and Practice levels are named after their skill, the Cook level after the recipe. */
  title: string;
  recipeId: string;
  recipe: string;
  /** Learn and Practice teach one skill each; the Cook level puts both to use. */
  skills: readonly Skill[];
  access: Access;
  recipeStatus: 'confirmed' | 'proposed';
}

export const CHAPTERS: readonly Chapter[] = [
  { chapter: 1, title: 'Kitchen Foundations', from: 1, to: 6 },
  { chapter: 2, title: 'Heat & Texture', from: 7, to: 12 },
  { chapter: 3, title: 'Baking Academy', from: 13, to: 15 },
  { chapter: 4, title: 'Everyday Chef', from: 16, to: 24 },
];

const skill = (id: string, name: string, focus: string, transfersTo: string[]): Skill => ({ id, name, focus, transfersTo });

/** The recipes in path order, each with the skills its Learn and Practice level teach. */
const PLAN: ReadonlyArray<Omit<Recipe, 'levels'>> = [
  {
    id: 'pizza-twists', name: 'Pizza Twists', kind: 'bake', access: 'free', recipeStatus: 'confirmed',
    skills: [
      skill('safe-cuts', 'Safe Cuts', 'Knife and tool safety, cut sizes', ['Veggie prep', 'Herbs', 'Fruit salad']),
      skill('cut-and-twist', 'Cut & Twist', 'Cutting dough into strips, filling and twisting', ['Hand pies', 'Cheese straws', 'Cookies']),
    ],
  },
  {
    id: 'egg-master-omelette', name: 'Egg Master Omelette', kind: 'cook', access: 'free', recipeStatus: 'confirmed',
    skills: [
      skill('heat-control', 'Heat Control', 'How heat works, doneness', ['Pancakes', 'Fried eggs', 'Grilled cheese']),
      skill('perfect-texture', 'Perfect Texture', 'Doneness, consistency, folding', ['Scrambled eggs', 'Frittata', 'Custard']),
    ],
  },
  {
    id: 'fluffy-pancakes', name: 'Fluffy Pancakes', kind: 'cook', access: 'free', recipeStatus: 'confirmed',
    skills: [
      skill('batter-science', 'Batter Science', 'Wet and dry ingredients, leavening', ['Muffins', 'Crêpes', 'Waffles']),
      skill('flip-master', 'Flip Master', 'Flipping, doneness cues, browning', ['French toast', 'Burger patties', 'Crêpes']),
    ],
  },
  {
    id: 'smash-burger-tacos', name: 'Smash Burger Tacos', kind: 'cook', access: 'free', recipeStatus: 'confirmed',
    skills: [
      skill('sizzle-effect', 'The Sizzle Effect', 'Searing, browning, hygiene', ['Seared steak', 'Stir-fry', 'Crispy potatoes']),
      skill('crispy-and-juicy', 'Crispy & Juicy', 'Moisture, crispness, combining', ['Quesadillas', 'Chicken thighs', 'Hash browns']),
    ],
  },
  {
    id: 'blueberry-vanilla-muffins', name: 'Blueberry Vanilla Muffins', kind: 'bake', access: 'free', recipeStatus: 'confirmed',
    skills: [
      skill('measure-like-a-chef', 'Measure Like a Chef', 'Ratios, weighing', ['Banana bread', 'Shortbread', 'Bread dough']),
      skill('mixing-matters', 'Mixing Matters', 'Mixing right, not overmixing', ['Brownies', 'Sponge cake', 'Scones']),
    ],
  },
  {
    id: 'mac-and-cheese', name: 'Mac & Cheese', kind: 'cook', access: 'plus', recipeStatus: 'confirmed',
    skills: [
      skill('sauce-science', 'Sauce Science', 'Creamy sauce, binding, consistency', ['Lasagne', 'Gravy', 'Creamy soups']),
      skill('perfect-timing', 'Perfect Timing', 'Coordinating pasta and sauce', ['Spaghetti bolognese', 'Curry and rice', 'Sunday roast']),
    ],
  },
  {
    id: 'rainbow-crunch-bowl', name: 'Rainbow Crunch Bowl', kind: 'cook', access: 'plus', recipeStatus: 'proposed',
    skills: [
      skill('knife-skills-2', 'Knife Skills 2.0', 'Prepping vegetables, piece sizes', ['Salsa', 'Coleslaw', 'Stir-fry']),
      skill('flavor-balance', 'Flavor Balance', 'Acid, salt, fat, spices', ['Salad dressing', 'Soups', 'Curry']),
    ],
  },
  {
    id: 'crispy-wrap', name: 'Crispy Wrap', kind: 'cook', access: 'plus', recipeStatus: 'proposed',
    skills: [
      skill('kitchen-organization', 'Kitchen Organization', 'Mise en place, workflows', ['Fajitas', 'Meal prep', 'Sheet-pan dinners']),
      skill('kitchen-multitasking', 'Kitchen Multitasking', 'Coordination and priorities', ['Full breakfast', 'Burgers and fries', 'Pasta with garlic bread']),
    ],
  },
];

/** The real recipes behind the path, three levels each. */
export const RECIPES: readonly Recipe[] = PLAN.map((r, i) => ({ ...r, levels: { learn: 3 * i + 1, practice: 3 * i + 2, cook: 3 * i + 3 } }));

const chapterOf = (level: number) => CHAPTERS.find((c) => level >= c.from && level <= c.to)?.chapter ?? 0;

export const LEVELS: readonly Level[] = RECIPES.flatMap((r) => {
  const level = (n: number, kind: LevelKind, title: string, skills: readonly Skill[]): Level => ({
    level: n,
    chapter: chapterOf(n),
    kind,
    title,
    recipeId: r.id,
    recipe: r.name,
    skills,
    access: r.access,
    recipeStatus: r.recipeStatus,
  });
  const [learnt, practised] = r.skills;
  return [
    level(r.levels.learn, 'learn', learnt.name, [learnt]),
    level(r.levels.practice, 'practice', practised.name, [practised]),
    level(r.levels.cook, 'cook', r.name, r.skills),
  ];
});

export const SKILLS: readonly Skill[] = RECIPES.flatMap((r) => r.skills);
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

export function recipeOfLevel(level: number): Recipe | undefined {
  return RECIPES.find((r) => r.levels.learn === level || r.levels.practice === level || r.levels.cook === level);
}
