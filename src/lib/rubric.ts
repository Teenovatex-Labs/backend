/** The agreed rubric. Each criterion is rated 1 to 5; the weighted result is advice, never an automatic decision. */
export const RUBRIC = {
  curiosity_creativity: 20,
  initiative_action: 25,
  growth_mindset: 20,
  collaboration_community: 15,
  motivation_commitment: 10,
  problem_solving_impact: 10,
} as const;

export type Criterion = keyof typeof RUBRIC;
export const CRITERIA = Object.keys(RUBRIC) as Criterion[];

/** On the same 1 to 5 scale as the ratings, rounded to two places. */
export const weightedScore = (scores: Record<Criterion, number>): number =>
  Math.round(CRITERIA.reduce((sum, c) => sum + scores[c] * RUBRIC[c], 0)) / 100;
