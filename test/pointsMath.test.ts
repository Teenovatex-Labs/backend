import { describe, expect, it } from 'vitest';
import { formatPoints, fromScaled, parseScaled, toScaled } from '../src/lib/pointsMath.js';

describe('points math', () => {
  it('converts without float drift', () => {
    expect(toScaled(0.1 + 0.2)).toBe(30);
    expect(toScaled(1.005)).toBe(101); // rounds, never stores a stray 100.49999
    expect(toScaled(5)).toBe(500);
    expect(fromScaled(150)).toBe(1.5);
    let total = 0;
    for (let i = 0; i < 1000; i++) total += toScaled(0.3);
    expect(total).toBe(30000);
  });

  it('formats with trimmed zeros and sign', () => {
    expect(formatPoints(150)).toBe('1.5');
    expect(formatPoints(500)).toBe('5');
    expect(formatPoints(30)).toBe('0.3');
    expect(formatPoints(5)).toBe('0.05');
    expect(formatPoints(-250)).toBe('-2.5');
    expect(formatPoints(0)).toBe('0');
  });

  it('parses only plain numbers with at most two decimals', () => {
    expect(parseScaled('1.5')).toBe(150);
    expect(parseScaled(0.3)).toBe(30);
    expect(parseScaled('-2')).toBe(-200);
    for (const bad of ['1.234', 'abc', '', '1e3', '1,5', ' ']) expect(parseScaled(bad)).toBeNull();
  });
});
