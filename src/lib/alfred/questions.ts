import { CRITERIA, type Criterion } from '../rubric.js';

/** What each rubric criterion means in plain words, for the prompt. */
export const FOCUS: Record<Criterion, string> = {
  curiosity_creativity: 'curiosity and creativity: how they explore ideas, wonder why things work, make original things',
  initiative_action: 'initiative: times they started or finished something themselves without being told to',
  growth_mindset: 'growth mindset: how they handle being stuck, failing, or not knowing, and what they learn',
  collaboration_community: 'collaboration: working with, helping or learning from other people',
  motivation_commitment: 'motivation: why they want to join and what they will do to make it worth it',
  problem_solving_impact: 'problem solving: breaking a hard problem down, or making something better for someone else',
};

/**
 * The fixed bank. It is both the fallback when the AI is off or fails and the reference for fair scoring:
 * every criterion has the same questions available to every applicant. Plain text, no trick questions.
 */
export const BANK: Record<Criterion, { key: string; text: string }[]> = {
  curiosity_creativity: [
    { key: 'cur1', text: 'What is something you wanted to figure out recently, and how did you go about it?' },
    { key: 'cur2', text: 'Tell us about something you made or imagined that was completely your own idea.' },
  ],
  initiative_action: [
    { key: 'ini1', text: 'Describe something you started on your own, with nobody telling you to. What did you do first?' },
    { key: 'ini2', text: 'Tell us about a project, big or small, that you actually finished. What kept you going?' },
  ],
  growth_mindset: [
    { key: 'gro1', text: 'Tell us about a time you got stuck or something went wrong. What did you do next?' },
    { key: 'gro2', text: 'What is something you are not good at yet, and what are you doing about it?' },
  ],
  collaboration_community: [
    { key: 'col1', text: 'Tell us about a time you worked with or helped other people on something. What was your part?' },
    { key: 'col2', text: 'What did you last learn from someone else, and how did it happen?' },
  ],
  motivation_commitment: [
    { key: 'mot1', text: 'Why do you want to join TeenovateX, and what will you do in your first month?' },
    { key: 'mot2', text: 'How many hours a week can you realistically give, and what would you do with them?' },
  ],
  problem_solving_impact: [
    { key: 'pro1', text: 'Tell us about a problem you solved, or would like to solve, that would help someone else.' },
    { key: 'pro2', text: 'Pick something that annoys you. How would you break it into steps to fix it?' },
  ],
};

export const TOTAL_QUESTIONS = 8;

/**
 * Which criterion the next question gathers evidence for. The first six cover every criterion once, so
 * nobody is scored on evidence missing for others. The last two go back to the heaviest-weighted ones.
 */
export const criterionFor = (position: number): Criterion => {
  const order: Criterion[] = [...CRITERIA, 'initiative_action', 'curiosity_creativity'];
  return order[position - 1] ?? 'initiative_action';
};

/** The first unused bank question for this criterion, or null when all are used. */
export const pickFallback = (criterion: Criterion, usedKeys: string[]) => BANK[criterion].find((q) => !usedKeys.includes(q.key)) ?? null;
