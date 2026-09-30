import { describe, expect, it } from 'vitest';
import { TRACKS } from '../prisma/content/learn.js';

describe('starter learn content', () => {
  it('has unique slugs and non-empty lessons', () => {
    expect(new Set(TRACKS.map((t) => t.slug)).size).toBe(TRACKS.length);
    for (const track of TRACKS) {
      expect(track.lessons.length).toBeGreaterThan(0);
      expect(new Set(track.lessons.map((l) => l.slug)).size).toBe(track.lessons.length);
      for (const lesson of track.lessons) {
        expect(lesson.slug).toMatch(/^[a-z0-9-]+$/);
        expect(lesson.body.length).toBeGreaterThan(200);
        expect(lesson.minutes).toBeGreaterThan(0);
      }
    }
  });
});
