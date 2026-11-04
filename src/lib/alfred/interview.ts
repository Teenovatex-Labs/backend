import { Prisma, type Application, type ApplicationAnswer } from '@prisma/client';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { audit } from '../audit.js';
import { createNotification } from '../notify.js';
import { send } from '../resend.js';
import { generate, hasProviders } from '../pet/providers.js';
import { FOCUS, TOTAL_QUESTIONS, criterionFor, pickFallback } from './questions.js';
import { PROMPT_VERSION, SYSTEM, userPrompt } from './persona.js';
import { SAFETY_REPLY, isSensitive } from './safety.js';

const textOf = (a: Pick<ApplicationAnswer, 'answer'>) => {
  const v = a.answer as { text?: unknown } | null;
  return typeof v?.text === 'string' ? v.text : '';
};

export const ANSWER_MAX = 1500;

const rows = (applicationId: string) => prisma.applicationAnswer.findMany({ where: { application_id: applicationId }, orderBy: { position: 'asc' } });

/** True once any answer the applicant gave looks like it needs a person, not an interviewer. */
export const hasSensitiveAnswer = (answers: ApplicationAnswer[]) => answers.some((a) => isSensitive(textOf(a)));

/** A usable AI question: short, a real question, and nothing that asks for contact details or links. */
export const acceptQuestion = (raw: string): string | null => {
  try {
    const q = (JSON.parse(raw) as { question?: unknown }).question;
    if (typeof q !== 'string') return null;
    const t = q.trim();
    if (t.length < 15 || t.length > 260 || !t.includes('?')) return null;
    if (/https?:|www\.|@|\d{7,}/i.test(t)) return null;
    return t;
  } catch {
    return null;
  }
};

const aiAllowed = (answers: ApplicationAnswer[]) => config.admissionsAiEnabled && hasProviders() && !hasSensitiveAnswer(answers);

/** Writes the next question (once). Safe to call twice: the second call returns the same row. */
export const ensureNextQuestion = async (app: Application): Promise<ApplicationAnswer | null> => {
  const answers = await rows(app.id);
  const open = answers.find((a) => textOf(a) === '');
  if (open) return open;
  if (answers.length >= TOTAL_QUESTIONS) return null;
  // Someone who told us something worrying is not put through more questions.
  if (hasSensitiveAnswer(answers)) return null;

  const position = answers.length + 1;
  const criterion = criterionFor(position);
  const used = answers.map((a) => a.question_key);
  let question: { key: string; text: string; source: 'ai' | 'fallback' } | null = null;

  if (aiAllowed(answers)) {
    try {
      const history = answers.map((a) => ({ question: a.question_text, answer: textOf(a) }));
      let accepted: string | null = null;
      await generate({ system: SYSTEM, user: userPrompt(FOCUS[criterion], history, app.interests) }, (t) => (accepted = acceptQuestion(t)) !== null, fetch, { maxTokens: 200, temperature: 0.7 });
      if (accepted) question = { key: `ai-${position}`, text: accepted, source: 'ai' };
    } catch {
      // Every provider failed or answered badly: the fixed bank takes over.
    }
  }
  if (!question) {
    const f = pickFallback(criterion, used);
    if (!f) return null;
    question = { key: f.key, text: f.text, source: 'fallback' };
  }

  try {
    return await prisma.applicationAnswer.create({
      data: { application_id: app.id, position, question_key: question.key, question_text: question.text, source: question.source, prompt_version: question.source === 'ai' ? PROMPT_VERSION : null, format: 'text', criterion },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return (await rows(app.id)).find((a) => a.position === position) ?? null;
    throw err;
  }
};

export type InterviewState = Awaited<ReturnType<typeof interviewState>>;

export const interviewState = async (app: Application) => {
  const answers = await rows(app.id);
  const answered = answers.filter((a) => textOf(a) !== '');
  const flagged = hasSensitiveAnswer(answers);
  const complete = answered.length >= TOTAL_QUESTIONS;
  return {
    total: TOTAL_QUESTIONS,
    answered: answered.length,
    complete,
    // Someone who flagged something may submit what they have, so a worried applicant is never trapped.
    can_submit: complete || (flagged && answered.length >= 1),
    questions: answers.map((a) => ({ position: a.position, question: a.question_text, format: a.format, answer: textOf(a) || null })),
  };
};

/**
 * Serious safety matters go only to the designated safeguarding lead and deputy, never to every reviewer.
 * If none are configured yet, admins are told instead (the smallest group that exists) and a warning is
 * logged, because an alert nobody sees is worse than one a few too many people see.
 */
const alertSafeguarding = async (reference: string) => {
  const designated = config.safeguardingEmails;
  const people = designated.length
    ? await prisma.user.findMany({ where: { email: { in: designated } }, select: { id: true, email: true } })
    : await prisma.user.findMany({ where: { role: 'admin' }, select: { id: true, email: true } });
  if (!designated.length) console.warn('SAFEGUARDING_LEAD_EMAILS is not set: safeguarding alerts are going to admins.');
  const message = `Safeguarding: please read application ${reference} today`;
  await Promise.all(people.map((p) => createNotification(p.id, 'application', message, { link: '/admin/applications' })));
  // Designated people may not be logged in, so they are also emailed. The email says nothing about the content.
  await Promise.all((designated.length ? designated : []).map((to) => send(to, 'Safeguarding alert: please open the admin console', '<p>An application needs a safeguarding review today. Open the admin console and read it with care. This email deliberately says nothing more.</p>', 'Safeguarding alert', reference).catch((err) => console.error('Safeguarding email failed:', err))));
};

/** Saves (or edits) an answer. Returns the fixed safety message if the answer needs a person. */
export const saveAnswer = async (app: Application, position: number, text: string) => {
  const row = await prisma.applicationAnswer.findUnique({ where: { application_id_position: { application_id: app.id, position } } });
  if (!row) return null;
  const previous = textOf(row);
  if (previous === text) return { safety: isSensitive(text) ? SAFETY_REPLY : null };
  await prisma.$transaction([
    ...(previous ? [prisma.applicationAnswerRevision.create({ data: { answer_id: row.id, answer: row.answer ?? Prisma.JsonNull } })] : []),
    prisma.applicationAnswer.update({ where: { id: row.id }, data: { answer: { text }, revision: previous ? { increment: 1 } : undefined } }),
  ]);
  if (!isSensitive(text)) return { safety: null };

  await audit(null, 'application.safeguarding_flag', { type: 'application', id: app.id }, { reference: app.reference, position });
  await alertSafeguarding(app.reference);
  return { safety: SAFETY_REPLY };
};
