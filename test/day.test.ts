import { describe, expect, it } from 'vitest';
import { localDay, nextLocalMidnight, shiftDay } from '../src/lib/day.js';

describe('local day helpers', () => {
  const instant = new Date('2026-03-10T23:30:00.000Z');

  it('names the calendar day in the member’s own time zone', () => {
    expect(localDay('UTC', instant)).toBe('2026-03-10');
    expect(localDay('Africa/Lagos', instant)).toBe('2026-03-11'); // UTC+1, already past midnight
    expect(localDay('America/Los_Angeles', instant)).toBe('2026-03-10');
  });

  it('falls back to UTC for a missing or unknown zone', () => {
    expect(localDay(null, instant)).toBe('2026-03-10');
    expect(localDay('Mars/Base', instant)).toBe('2026-03-10');
  });

  it('shifts days across month and year edges', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('finds the member’s next midnight', () => {
    // 23:30 UTC is 00:30 in Lagos, so the next Lagos midnight is 23:00 UTC the following day.
    expect(nextLocalMidnight('Africa/Lagos', instant).toISOString()).toBe('2026-03-11T23:00:00.000Z');
    expect(nextLocalMidnight('UTC', instant).toISOString()).toBe('2026-03-11T00:00:00.000Z');
  });
});
