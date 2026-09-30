import { isValidTimezone } from './age.js';

const safeZone = (timezone: string | null | undefined): string =>
  timezone && isValidTimezone(timezone) ? timezone : 'UTC';

/** The calendar day (YYYY-MM-DD) it is right now, or at `at`, for a member in `timezone`. */
export const localDay = (timezone: string | null | undefined, at: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

/** Shifts a YYYY-MM-DD day by whole days. Pure calendar maths, so it never drifts on DST. */
export const shiftDay = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** A YYYY-MM-DD day as a Date at midnight UTC, ready for a Prisma @db.Date column. */
export const dayToDb = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** The instant the member's next local day begins (their daily reset). */
export const nextLocalMidnight = (timezone: string | null | undefined, at: Date = new Date()): Date => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeZone(timezone),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const sinceMidnightMs = ((n('hour') * 60 + n('minute')) * 60 + n('second')) * 1000 + at.getMilliseconds();
  return new Date(at.getTime() - sinceMidnightMs + 24 * 60 * 60 * 1000);
};
