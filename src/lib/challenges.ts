export type Criterion = { name: string; weight: number };

/** Weighted average of 0 to 10 scores, in hundredths (8.5 -> 850). Every criterion must be scored. */
export const weightedTotal = (criteria: Criterion[], scores: Record<string, number>): number => {
  const weights = criteria.reduce((n, c) => n + c.weight, 0);
  const sum = criteria.reduce((n, c) => n + c.weight * scores[c.name], 0);
  return Math.round((sum / weights) * 100);
};

export type Ranked = { entryId: string; userId: string; total: number; place: number };

/** Highest total first. Ties share a place and the next place skips ahead (1, 1, 3). */
export const rank = (rows: { entryId: string; userId: string; total: number }[]): Ranked[] => {
  const sorted = [...rows].sort((a, b) => b.total - a.total || a.entryId.localeCompare(b.entryId));
  return sorted.map((r, i) => {
    const firstOfTie = sorted.findIndex((x) => x.total === r.total);
    return { ...r, place: firstOfTie + 1 };
  });
};

export const PRIZE_RULES = { 1: 'challenge_place_1', 2: 'challenge_place_2', 3: 'challenge_place_3' } as const;
