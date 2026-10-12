/** A calendar date in the user's own time zone, formatted YYYY-MM-DD. */
export type LocalDate = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function toMs(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromMs(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromMs(toMs(date) + days * DAY_MS);
}

/** Monday = 0 … Sunday = 6. */
export function weekdayIndex(date: LocalDate): number {
  return (new Date(toMs(date)).getUTCDay() + 6) % 7;
}

export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, -weekdayIndex(date));
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

/** ISO 8601 week: weeks start on Monday, week 1 contains the year's first Thursday. */
export function isoWeek(date: LocalDate): { year: number; week: number } {
  const thursday = new Date(toMs(date));
  thursday.setUTCDate(thursday.getUTCDate() - weekdayIndex(date) + 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = Date.UTC(year, 0, 4 - ((jan4.getUTCDay() + 6) % 7));
  const week = Math.floor((thursday.getTime() - week1Monday) / (7 * DAY_MS)) + 1;
  return { year, week };
}

export function weekLabel(date: LocalDate): string {
  return `W${isoWeek(date).week}`;
}

export function todayIn(timeZone: string, now: Date): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}
