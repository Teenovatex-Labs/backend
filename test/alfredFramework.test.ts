import { describe, expect, it } from 'vitest';
import { BANK, FOCUS, pickFallback } from '../src/lib/alfred/questions.js';
import { CRITERIA, CRITERION_GUIDE, RATING_GUIDE, weightedScore } from '../src/lib/rubric.js';

const all = (n: number | null) => Object.fromEntries(CRITERIA.map((c) => [c, n])) as Record<(typeof CRITERIA)[number], number | null>;

describe('weighted score with insufficient evidence', () => {
  it('matches the agreed weights when everything is rated', () => {
    expect(weightedScore({ ...all(4), initiative_action: 2 })).toBe(3.5);
  });
  it('leaves unrated criteria out instead of counting them as a 1', () => {
    // Only initiative (25) and curiosity (20) rated: (5*25 + 3*20) / 45
    const s = { ...all(null), initiative_action: 5, curiosity_creativity: 3 };
    expect(weightedScore(s)).toBe(4.11);
  });
  it('returns null when nothing could be rated', () => {
    expect(weightedScore(all(null))).toBeNull();
  });
});

describe('Alfred framework content', () => {
  it('has guidance and a focus line for every criterion, and a 1 to 5 guide', () => {
    for (const c of CRITERIA) {
      expect(CRITERION_GUIDE[c].examples.length).toBeGreaterThan(0);
      expect(FOCUS[c].length).toBeGreaterThan(40);
    }
    expect(RATING_GUIDE.map((r) => r.rating)).toEqual([1, 2, 3, 4, 5]);
  });

  it('has several fallback variants per criterion with unique keys', () => {
    const keys = CRITERIA.flatMap((c) => BANK[c].map((b) => b.key));
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of CRITERIA) expect(BANK[c].length).toBeGreaterThanOrEqual(4);
  });

  it('prefers questions that suit the applicant and never repeats one', () => {
    const tech = pickFallback('initiative_action', [], { age: 16, interests: ['Coding'] });
    expect(tech?.key).toBe('ini5');
    const plain = pickFallback('initiative_action', [], { age: 16, interests: ['painting'] });
    expect(plain?.key).toBe('ini1');
    expect(pickFallback('initiative_action', ['ini1'], { age: 16, interests: ['painting'] })?.key).toBe('ini2');
    // interest-specific questions are not offered to people who do not share the interest
    const used = BANK.initiative_action.filter((b) => b.interests.length === 0).map((b) => b.key);
    expect(pickFallback('initiative_action', used, { age: 16, interests: ['painting'] })).toBeNull();
  });
});
