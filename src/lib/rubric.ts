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

/** A reviewer's rating: 1 to 5, or null for "insufficient evidence" (not the same thing as a 1). */
export type Rating = number | null;

/**
 * On the same 1 to 5 scale as the ratings, rounded to two places. Criteria marked insufficient evidence are left
 * out and the remaining weights are scaled up to 100, so missing evidence is never counted as a low score.
 * Returns null when nothing could be scored.
 */
export const weightedScore = (scores: Record<Criterion, Rating>): number | null => {
  const scored = CRITERIA.filter((c) => scores[c] !== null && scores[c] !== undefined);
  const weight = scored.reduce((sum, c) => sum + RUBRIC[c], 0);
  if (weight === 0) return null;
  const total = scored.reduce((sum, c) => sum + (scores[c] as number) * RUBRIC[c], 0);
  return Math.round((total / weight) * 100) / 100;
};

/** What each rating means, shown to reviewers and given to Alfred when he suggests evidence. */
export const RATING_GUIDE: { rating: number; label: string; meaning: string }[] = [
  { rating: 1, label: 'Limited demonstrated evidence', meaning: 'Little relevant evidence even after reasonable clarification, or a clear concern tied to this criterion. Never give a 1 just because someone is inexperienced, shy, writes short answers or has not built anything.' },
  { rating: 2, label: 'Emerging', meaning: 'Some relevant evidence, but the thinking, actions or explanations are still developing.' },
  { rating: 3, label: 'Promising', meaning: 'A reasonable understanding of the criterion with believable examples, explanations or thoughtful scenario answers.' },
  { rating: 4, label: 'Strong', meaning: 'Clear evidence through specific actions, thoughtful reasoning, adaptability or meaningful contributions.' },
  { rating: 5, label: 'Exceptional', meaning: 'Particularly strong, well-supported evidence, relative to their experience and opportunities. No prestige, money or credentials needed.' },
];

export const INSUFFICIENT_EVIDENCE = 'Insufficient evidence: not enough relevant evidence was gathered to rate this. It is separate from a 1. Ask a clarifying question or leave it unrated.';

/** What to look for, and what not to count, for each criterion. */
export const CRITERION_GUIDE: Record<Criterion, { title: string; lookFor: string; examples: string[]; notThis: string }> = {
  curiosity_creativity: {
    title: 'Curiosity & Creativity',
    lookFor: 'Explores ideas, asks questions, thinks independently, wants to understand how things work.',
    examples: ['Exploring an unusual idea', 'Asking thoughtful questions', 'Trying to understand how something works', 'Suggesting creative alternatives', 'Genuine enthusiasm for learning'],
    notThis: 'Depth of exploration and independent thinking, not how advanced the subject is.',
  },
  initiative_action: {
    title: 'Initiative & Action',
    lookFor: 'Takes action instead of waiting for perfect circumstances. Small attempts and experiments count.',
    examples: ['Learning something independently', 'Starting a small project', 'Trying to solve a problem', 'Organising something', 'Acting on an idea with limited resources'],
    notThis: 'Actions or realistic attempts, not the scale or success of finished projects. No previous projects is not automatically a low rating.',
  },
  growth_mindset: {
    title: 'Growth Mindset',
    lookFor: 'Can learn, take constructive feedback, adapt and improve. Perfection and constant confidence are not required.',
    examples: ['Acknowledging mistakes', 'Learning from failed attempts', 'Openness to feedback', 'Trying different approaches', 'Persistence or thoughtful adaptation'],
    notThis: 'Reflection, openness and adaptation, not a perfectly polished story about failure.',
  },
  collaboration_community: {
    title: 'Collaboration & Community',
    lookFor: 'Works constructively with others, respects other views, contributes to a community.',
    examples: ['Supporting someone else', 'Listening to different opinions', 'Sharing useful knowledge', 'Resolving disagreements respectfully', 'Taking responsibility in group work'],
    notThis: 'Respect, listening, shared responsibility and constructive teamwork, not extroversion.',
  },
  motivation_commitment: {
    title: 'Motivation & Commitment',
    lookFor: 'A genuine reason for joining and a realistic willingness to take part. Nobody has to give their whole life to TeenovateX.',
    examples: ['Genuine interest in the community', 'Clear personal learning goals', 'Realistic expectations', 'Willingness to contribute', 'Awareness of other responsibilities'],
    notThis: 'Genuine interest and realistic commitment, not dramatic promises.',
  },
  problem_solving_impact: {
    title: 'Problem-Solving & Impact',
    lookFor: 'Notices problems and thinks constructively about improving things. Impact does not need a company or thousands of lives.',
    examples: ['Identifying a meaningful problem', 'Understanding who it affects', 'Considering practical solutions', 'Thinking about consequences', 'Making small improvements'],
    notThis: 'Thoughtful problem spotting and practical reasoning, not expensive or technically complex solutions.',
  },
};
