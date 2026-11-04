import type { Application, ApplicationAnswer } from '@prisma/client';
import { config } from '../../config.js';
import { generate, hasProviders } from '../pet/providers.js';
import { hasSensitiveAnswer } from './interview.js';

export const SUMMARY_PROMPT_VERSION = 'sum-1';

/**
 * A neutral reading aid for human reviewers, never a decision. It sees only what the applicant wrote about their
 * interests and answers: no name, no contact details, no birth date, no school or location.
 */
const SYSTEM = [
  'You help a human reviewer read a young person\'s application to a teen innovation community.',
  'Write 4 to 6 short bullet points that restate, in neutral words, what the applicant said about: what they have made or tried, how they learn, what they want to do next, and any initiative or curiosity they showed.',
  'Rules: do not recommend accepting or declining; do not score or rank; do not guess age, background, family, health, personality or intent; do not judge writing style or English; if something is missing, say it was not mentioned.',
  'Quote at most a few words at a time. Plain text bullets starting with "- ". Never include links, emails or phone numbers.',
].join(' ');

type Input = Pick<Application, 'interests' | 'skill_level' | 'current_skills' | 'learning_goals'> & { answers: Pick<ApplicationAnswer, 'question_text' | 'answer'>[] };

const textOf = (a: Pick<ApplicationAnswer, 'answer'>) => ((a.answer as { text?: unknown } | null)?.text as string | undefined) ?? '';

export const buildInput = (a: Input) =>
  [
    `Interests: ${a.interests.join(', ') || 'none given'}`,
    `Self-described level: ${a.skill_level ?? 'not given'}`,
    `Current skills: ${a.current_skills ?? 'not given'}`,
    `Goals: ${a.learning_goals ?? 'not given'}`,
    ...a.answers.map((x, i) => `Question ${i + 1}: ${x.question_text}\nAnswer: ${textOf(x) || '(unanswered)'}`),
  ].join('\n\n');

/** Plain bullets only: right size, every line a bullet, nothing that looks like contact details or a link. */
export const acceptSummary = (raw: string): string | null => {
  const t = raw.trim();
  if (t.length < 60 || t.length > 1600) return null;
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3 || lines.length > 8 || !lines.every((l) => l.startsWith('- '))) return null;
  if (/https?:|www\.|@|\d{7,}/i.test(t)) return null;
  if (/\b(accept|decline|reject|recommend)\b/i.test(t)) return null;
  return lines.join('\n');
};

export type SummaryResult = { ok: true; summary: string; prompt_version: string } | { ok: false; reason: 'DISABLED' | 'SENSITIVE' | 'FAILED' };

export const summarise = async (a: Input & { answers: ApplicationAnswer[] }): Promise<SummaryResult> => {
  if (!config.admissionsAiEnabled || !config.admissionsSummaryEnabled || !hasProviders()) return { ok: false, reason: 'DISABLED' };
  // Anything that looks like a worry is for a person to read in full, not to be condensed.
  if (hasSensitiveAnswer(a.answers)) return { ok: false, reason: 'SENSITIVE' };
  try {
    let accepted: string | null = null;
    await generate({ system: SYSTEM, user: buildInput(a) }, (t) => (accepted = acceptSummary(t)) !== null, fetch, { maxTokens: 450, temperature: 0.2 });
    return accepted ? { ok: true, summary: accepted, prompt_version: SUMMARY_PROMPT_VERSION } : { ok: false, reason: 'FAILED' };
  } catch {
    return { ok: false, reason: 'FAILED' };
  }
};
