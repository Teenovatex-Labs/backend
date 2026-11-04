import { CRITERIA, CRITERION_GUIDE, type Criterion } from '../rubric.js';

/** What each rubric criterion means in plain words, for the prompt. Built from the reviewer guidance so the two never drift. */
export const FOCUS: Record<Criterion, string> = Object.fromEntries(
  CRITERIA.map((c) => [c, `${CRITERION_GUIDE[c].title.toLowerCase()}: ${CRITERION_GUIDE[c].lookFor} Count: ${CRITERION_GUIDE[c].examples.join('; ').toLowerCase()}. Do not require: ${CRITERION_GUIDE[c].notThis.toLowerCase()}`]),
) as Record<Criterion, string>;

export type BankQuestion = {
  key: string;
  text: string;
  /** Inclusive age range this reads well for. */
  ages: [number, number];
  /** Interests this is especially suited to. Empty means anyone. */
  interests: string[];
  difficulty: 'easy' | 'medium';
  /** How it is meant to be answered. Today every answer is typed text; richer formats are a front-end addition. */
  format: 'text' | 'scenario';
  /** Prompts a person or Alfred can use to go deeper on the answer. */
  followups: string[];
};

const ANY: [number, number] = [13, 19];
const q = (key: string, text: string, o: Partial<Omit<BankQuestion, 'key' | 'text'>> = {}): BankQuestion => ({ key, text, ages: ANY, interests: [], difficulty: 'easy', format: 'text', followups: [], ...o });

const TECH = ['coding', 'programming', 'software', 'web', 'apps', 'technology', 'computers', 'robotics', 'robots', 'games'];
const BIZ = ['business', 'startups', 'startup', 'entrepreneurship', 'sales', 'money', 'marketing'];

/**
 * The fallback bank, used only when the AI is off or fails. It is NOT the application questionnaire: normally every
 * question is written for the applicant. It covers the same six criteria as generated questions do.
 * Plain wording first, so the first fallback an applicant sees is calm; playful variants come after.
 */
export const BANK: Record<Criterion, BankQuestion[]> = {
  curiosity_creativity: [
    q('cur1', 'What is something you wanted to figure out recently, and how did you go about it?'),
    q('cur2', 'Tell us about something you made or imagined that was completely your own idea.'),
    q('cur3', 'What is something you discovered recently that made your brain go, "Wait, hold on, HOW does that work?"', { followups: ['What did you try to find out more?', 'What would you ask the person who built it?'] }),
    q('cur4', 'If you could spend a whole weekend investigating one completely random topic, what would it be? (And please do not say how to become a billionaire by Monday. 😭)', { difficulty: 'medium', format: 'scenario' }),
  ],
  initiative_action: [
    q('ini1', 'Describe something you started on your own, with nobody telling you to. What did you do first?'),
    q('ini2', 'Tell us about a project, big or small, that you actually finished. What kept you going?'),
    q('ini3', 'What is something you started simply because you wanted to? Nobody assigned it, nobody promised a certificate, you just decided.', { followups: ['What was the very first step?', 'What got in the way?'] }),
    q('ini4', 'You have a really interesting idea, but nobody around you understands why you are excited. What is your next move?', { format: 'scenario', followups: ['Who would you try to find?', 'What is the smallest version you could try this week?'] }),
    q('ini5', 'Your code works perfectly on your laptop. You deploy it, and suddenly the whole app behaves like it has personal problems. 💀 What is the first thing you check?', { interests: TECH, ages: [14, 19], difficulty: 'medium', format: 'scenario', followups: ['How would you know if that was the cause?'] }),
    q('ini6', 'Someone hands you ₦10,000 and says you have one week to turn it into something useful. No gambling, no mysterious billionaire uncle, and your friends are somehow all unavailable. 😭 What is your plan?', { interests: BIZ, ages: [14, 19], difficulty: 'medium', format: 'scenario', followups: ['What if nobody wants to buy it? Do you pivot, improve it, or stare dramatically out of a window?'] }),
  ],
  growth_mindset: [
    q('gro1', 'Tell us about a time you got stuck or something went wrong. What did you do next?'),
    q('gro2', 'What is something you are not good at yet, and what are you doing about it?'),
    q('gro3', 'Tell us about something you thought would be easy until reality decided to humble you. 😭 What happened next?', { followups: ['What would you do differently now?'] }),
    q('gro4', 'Imagine you spent two weeks on something, and someone gives you feedback that completely challenges your approach. What is going through your mind?', { difficulty: 'medium', format: 'scenario', followups: ['What would you do first?'] }),
  ],
  collaboration_community: [
    q('col1', 'Tell us about a time you worked with or helped other people on something. What was your part?'),
    q('col2', 'What did you last learn from someone else, and how did it happen?'),
    q('col3', 'You are working with three people. One has 47 ideas per minute, one keeps disappearing, and the third thinks every suggestion is terrible. Congratulations, you are the team lead. 😭 What do you do?', { difficulty: 'medium', format: 'scenario', followups: ['How would you make sure the quiet one is heard?'] }),
    q('col4', 'Imagine you meet a Teenovator who knows nothing about something you are good at. How would you help them get started?', { format: 'scenario' }),
  ],
  motivation_commitment: [
    q('mot1', 'Why do you want to join TeenovateX, and what will you do in your first month?'),
    q('mot2', 'How many hours a week can you realistically give, and what would you do with them?'),
    q('mot3', 'Fast-forward six months. You have been part of TeenovateX for a while. What would make you say, "Yeah, joining this place was actually worth it"?', { format: 'scenario' }),
    q('mot4', 'School, life, responsibilities, everything happening at once. How would you realistically make time for something you are excited about?', { difficulty: 'medium' }),
  ],
  problem_solving_impact: [
    q('pro1', 'Tell us about a problem you solved, or would like to solve, that would help someone else.'),
    q('pro2', 'Pick something that annoys you. How would you break it into steps to fix it?'),
    q('pro3', 'What is one thing around you that is so unnecessarily complicated it makes you wonder who approved the design? 😭 How would you make it better?', { followups: ['Who does it affect most?'] }),
    q('pro4', 'You get a small team and one month to improve something in your community. What do you work on first, and why?', { difficulty: 'medium', format: 'scenario' }),
    q('pro5', 'You can fix ONE annoying problem in your school or community. Teleportation and unlimited money are unavailable. Budget cuts. 😭 What are you fixing?', { format: 'scenario', followups: ['Who would notice first?'] }),
  ],
};

/** The hard ceiling on questions. Alfred may stop earlier once every criterion has evidence; he never goes past this. */
export const TOTAL_QUESTIONS = 8;

/**
 * Which criterion the next question gathers evidence for. The first six cover every criterion once, so
 * nobody is scored on evidence missing for others. The last two go back to the heaviest-weighted ones.
 */
export const criterionFor = (position: number): Criterion => {
  const order: Criterion[] = [...CRITERIA, 'initiative_action', 'curiosity_creativity'];
  return order[position - 1] ?? 'initiative_action';
};

export type Fit = { age?: number | null; interests?: string[] };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The best unused bank question for this criterion, or null when all are used. Questions outside the applicant's age
 * range are skipped; ones that match their interests come first; ties keep bank order, so the plainest comes first.
 */
export const pickFallback = (criterion: Criterion, usedKeys: string[], fit: Fit = {}): BankQuestion | null => {
  const mine = new Set((fit.interests ?? []).map(norm));
  // A question written for an interest is only for people who share it.
  const unused = BANK[criterion].filter((b) => !usedKeys.includes(b.key) && (b.interests.length === 0 || b.interests.some((i) => mine.has(norm(i)))));
  const inAge = unused.filter((b) => fit.age == null || (fit.age >= b.ages[0] && fit.age <= b.ages[1]));
  const pool = inAge.length ? inAge : unused;
  let best: BankQuestion | null = null;
  let bestScore = -1;
  for (const b of pool) {
    const score = b.interests.filter((i) => mine.has(norm(i))).length;
    if (score > bestScore) { best = b; bestScore = score; }
  }
  return best;
};
