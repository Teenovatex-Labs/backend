// Levels come straight from points, so there is nothing extra to store or keep in sync.
const LEVELS = [
  { at: 0, title: 'Spark' },
  { at: 20, title: 'Tinkerer' },
  { at: 60, title: 'Maker' },
  { at: 120, title: 'Builder' },
  { at: 200, title: 'Creator' },
  { at: 320, title: 'Inventor' },
  { at: 480, title: 'Innovator' },
  { at: 700, title: 'Trailblazer' },
  { at: 1000, title: 'Visionary' },
  { at: 1400, title: 'Legend' },
] as const;

export type LevelInfo = { level: number; title: string; points: number; level_start: number; next_at: number | null; progress: number };

export const levelFor = (points: number): LevelInfo => {
  const p = Math.max(0, points);
  let i = 0;
  while (i + 1 < LEVELS.length && p >= LEVELS[i + 1]!.at) i++;
  const here = LEVELS[i]!;
  const next = LEVELS[i + 1];
  return {
    level: i + 1,
    title: here.title,
    points: p,
    level_start: here.at,
    next_at: next?.at ?? null,
    progress: next ? (p - here.at) / (next.at - here.at) : 1,
  };
};
