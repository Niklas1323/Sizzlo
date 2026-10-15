import { SKILL_LEVELS, sourceOf } from './curriculum.ts';
import type { Level } from './curriculum.ts';
import { addDays, daysBetween } from './dates.ts';
import type { LocalDate } from './dates.ts';

/**
 * Skill refresh: skills fade a little when they aren't used, and a 2-minute drill
 * brings them back. A skill joins once it is understood (its Learn level done);
 * that is its first review moment. Every later review moment restarts its clock:
 * - a Practice result of its lesson or recipe (the stars are the score)
 * - a real cook that marks it as tried (score 3)
 * - a refresh drill (score 0–3)
 * A score of 2 or more is a success and stretches the interval to the next
 * review; a lower score starts the intervals over but still counts as a moment.
 */

/** Days until a skill is due, by its successful reviews so far; the last one repeats. */
export const REFRESH_INTERVALS: readonly number[] = [3, 7, 14, 30, 60, 120];
/** Strength never drops below this: a skill once learnt is never gone. */
export const MIN_STRENGTH = 10;
/** Lowest score that counts as a successful review. */
export const PASS_SCORE = 2;
/** A real cook counts as a perfect review of the skills it marks. */
export const COOK_SCORE = 3;
export const DRILL_MINUTES = 2;
/** The refresh card suggests at most this many skills at once. */
export const MAX_DUE = 3;

export type RefreshScore = 0 | 1 | 2 | 3;

/**
 * fresh   – strength 80 or more
 * fading  – 50–79
 * refresh – below 50: time for a drill
 */
export type RefreshState = 'fresh' | 'fading' | 'refresh';

export interface ReviewMoment {
  on: LocalDate;
  /** When it was recorded; orders the moments of one day. */
  at: string;
  score: number;
}

export interface SkillMemory {
  /** Successful reviews since the skill joined or last failed. */
  reviews: number;
  lastReviewedOn: LocalDate;
}

export interface RefreshSkill {
  id: string;
  name: string;
  strength: number;
  state: RefreshState;
  /** The day strength reaches 50. */
  dueOn: LocalDate;
  reviews: number;
  lastReviewedOn: LocalDate;
  drill: { level: number; kind: 'learn' | 'practice'; minutes: number };
}

export function intervalFor(reviews: number): number {
  return REFRESH_INTERVALS[Math.min(reviews, REFRESH_INTERVALS.length - 1)];
}

/** Replays a skill's review moments, oldest first, from the day it joined. */
export function skillMemory(joinedOn: LocalDate, moments: readonly ReviewMoment[]): SkillMemory {
  const ordered = [...moments].sort((a, b) => a.on.localeCompare(b.on) || a.at.localeCompare(b.at));
  return ordered.reduce<SkillMemory>(
    (m, r) => ({ reviews: r.score >= PASS_SCORE ? m.reviews + 1 : 0, lastReviewedOn: r.on > m.lastReviewedOn ? r.on : m.lastReviewedOn }),
    { reviews: 0, lastReviewedOn: joinedOn },
  );
}

/** 100 right after a review, 50 on the due date, then slowly down to the floor. */
export function strengthOf(memory: SkillMemory, today: LocalDate): number {
  const elapsed = Math.max(0, daysBetween(memory.lastReviewedOn, today));
  return Math.max(MIN_STRENGTH, Math.round(100 * 0.5 ** (elapsed / intervalFor(memory.reviews))));
}

export function refreshState(strength: number): RefreshState {
  if (strength >= 80) return 'fresh';
  return strength >= 50 ? 'fading' : 'refresh';
}

export function dueOn(memory: SkillMemory): LocalDate {
  return addDays(memory.lastReviewedOn, intervalFor(memory.reviews));
}

/** The drill for a skill: its lesson's or recipe's Practice level, or the Learn level when there is none. */
export function drillFor(taught: Level): RefreshSkill['drill'] {
  const { learn, practice } = sourceOf(taught).levels;
  return practice === null ? { level: learn, kind: 'learn', minutes: DRILL_MINUTES } : { level: practice, kind: 'practice', minutes: DRILL_MINUTES };
}

export interface RefreshInput {
  today: LocalDate;
  /** Learn levels finished: level → local day. */
  learnedOn: ReadonlyMap<number, LocalDate>;
  /** Every Practice result. */
  practice: readonly { level: number; stars: number; on: LocalDate; at: string }[];
  /** The skills real cooks marked as tried: one row per cook and skill. */
  cooked: readonly { skillId: string; on: LocalDate; at: string }[];
  refreshes: readonly { skillId: string; score: number; on: LocalDate; at: string }[];
}

/** Every skill that joined, in path order, and the ones due for a refresh (weakest first). */
export function skillRefresh(input: RefreshInput) {
  const skills = SKILL_LEVELS.flatMap((taught): RefreshSkill[] => {
    const { id, name } = taught.skills[0];
    const { learn, practice } = sourceOf(taught).levels;
    const played = input.practice.filter((p) => p.level === practice);
    const joinedOn = input.learnedOn.get(learn) ?? played[0]?.on;
    if (!joinedOn) return [];
    const memory = skillMemory(joinedOn, [
      ...played.map((p) => ({ on: p.on, at: p.at, score: p.stars })),
      ...input.cooked.filter((c) => c.skillId === id).map((c) => ({ on: c.on, at: c.at, score: COOK_SCORE })),
      ...input.refreshes.filter((r) => r.skillId === id),
    ]);
    const strength = strengthOf(memory, input.today);
    return [{ id, name, strength, state: refreshState(strength), dueOn: dueOn(memory), reviews: memory.reviews, lastReviewedOn: memory.lastReviewedOn, drill: drillFor(taught) }];
  });
  return { due: dueForRefresh(skills).slice(0, MAX_DUE), skills };
}

/** Skills in the refresh state, weakest first; ties go to the older review, then path order (the sort is stable). */
export function dueForRefresh(skills: readonly RefreshSkill[]): RefreshSkill[] {
  return skills.filter((s) => s.state === 'refresh').sort((a, b) => a.strength - b.strength || a.lastReviewedOn.localeCompare(b.lastReviewedOn));
}

/** For the profile and the widget: how many skills need a refresh, and the weakest of them. */
export function refreshSummary(skills: readonly RefreshSkill[]) {
  const due = dueForRefresh(skills);
  const weakest = due[0];
  return { due: due.length, weakest: weakest ? { id: weakest.id, name: weakest.name, strength: weakest.strength } : null };
}
