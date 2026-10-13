import { addDays, isoWeek, mondayOf, weekLabel } from './dates.ts';
import type { LocalDate } from './dates.ts';

/**
 * done   – cooked (or baked) at least one recipe for the first time that week
 * saved  – no project, but a Holiday Save protected the streak (spent automatically)
 * missed – no project and no save: the streak restarts
 * open   – the current week, still time to cook
 */
export type WeekStatus = 'done' | 'saved' | 'missed' | 'open';

export interface StreakInput {
  today: LocalDate;
  /** Dates of streak-counting projects (see streakProjectDates). Future dates are ignored. */
  projectDates: readonly LocalDate[];
  savesPerYear: number;
}

export interface StreakWeek {
  weekStart: LocalDate;
  label: string;
  isoYear: number;
  isoWeek: number;
  status: WeekStatus;
  projects: number;
}

export interface StreakResult {
  /** Consecutive cooking weeks, ending this week if it is done, otherwise last week. */
  current: number;
  best: number;
  /** The current week is never saved: it only counts as missed once it is over. */
  thisWeek: { weekStart: LocalDate; status: 'done' | 'open'; projects: number };
  /** True when the user has a streak and has not cooked yet this week. */
  atRisk: boolean;
  /** Every week from the first project up to this week, oldest first. */
  weeks: StreakWeek[];
  holidaySaves: { perYear: number; usedThisYear: number; left: number };
}

/**
 * Only the first time a user cooks a recipe counts towards the streak. Cooking a recipe
 * again is always allowed and logged, it just doesn't keep the streak going.
 */
export function streakProjectDates(cooks: readonly { cookedOn: LocalDate; recipeId: string }[]): LocalDate[] {
  const first = new Map<string, LocalDate>();
  for (const cook of cooks) {
    const seen = first.get(cook.recipeId);
    if (!seen || cook.cookedOn < seen) first.set(cook.recipeId, cook.cookedOn);
  }
  return [...first.values()];
}

export function computeStreak(input: StreakInput): StreakResult {
  const thisMonday = mondayOf(input.today);
  const perWeek = new Map<LocalDate, number>();
  for (const date of input.projectDates) {
    if (date > input.today) continue;
    const monday = mondayOf(date);
    perWeek.set(monday, (perWeek.get(monday) ?? 0) + 1);
  }
  const usedByYear = new Map<number, number>();
  const savesLeftIn = (year: number) => input.savesPerYear - (usedByYear.get(year) ?? 0);
  const spendSave = (year: number) => usedByYear.set(year, (usedByYear.get(year) ?? 0) + 1);

  const weeks: StreakWeek[] = [];
  let current = 0;
  let best = 0;

  const firstMonday = [...perWeek.keys()].sort()[0];
  if (firstMonday) {
    for (let monday = firstMonday; monday <= thisMonday; monday = addDays(monday, 7)) {
      const { year, week } = isoWeek(monday);
      const projects = perWeek.get(monday) ?? 0;
      let status: WeekStatus;
      if (projects > 0) {
        status = 'done';
        current += 1;
      } else if (monday === thisMonday) {
        status = 'open';
      } else if (savesLeftIn(year) > 0) {
        // A missed week spends a save while the year still has one; the user never has to pick it.
        status = 'saved';
        spendSave(year);
      } else {
        status = 'missed';
        current = 0;
      }
      best = Math.max(best, current);
      weeks.push({ weekStart: monday, label: weekLabel(monday), isoYear: year, isoWeek: week, status, projects });
    }
  }

  const last = weeks[weeks.length - 1];
  const thisWeek =
    last && last.weekStart === thisMonday
      ? { weekStart: thisMonday, status: last.status as 'done' | 'open', projects: last.projects }
      : { weekStart: thisMonday, status: 'open' as const, projects: 0 };

  const usedThisYear = usedByYear.get(isoWeek(input.today).year) ?? 0;
  return {
    current,
    best,
    thisWeek,
    atRisk: current > 0 && thisWeek.status === 'open',
    weeks,
    holidaySaves: {
      perYear: input.savesPerYear,
      usedThisYear,
      left: Math.max(0, input.savesPerYear - usedThisYear),
    },
  };
}

/** "none" marks a week before the user's first real project. */
export type RecentWeek = Omit<StreakWeek, 'status'> & { status: WeekStatus | 'none' };

/** The last `count` weeks up to this week, oldest first, including weeks before the first project. */
export function recentWeeks(result: StreakResult, today: LocalDate, count: number): RecentWeek[] {
  const byMonday = new Map(result.weeks.map((w) => [w.weekStart, w]));
  const thisMonday = mondayOf(today);
  const out: RecentWeek[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const monday = addDays(thisMonday, -7 * i);
    const known = byMonday.get(monday);
    if (known) {
      out.push(known);
      continue;
    }
    const { year, week } = isoWeek(monday);
    out.push({
      weekStart: monday,
      label: weekLabel(monday),
      isoYear: year,
      isoWeek: week,
      status: monday === thisMonday ? 'open' : 'none',
      projects: 0,
    });
  }
  return out;
}
