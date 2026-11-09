import { Prisma, type Application, type ApplicationAnswer } from '@prisma/client';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { audit } from '../audit.js';
import { createNotification } from '../notify.js';
import { send } from '../resend.js';
import { generate, hasProviders } from '../pet/providers.js';
import { ageOn } from '../age.js';
import { windowIsTest } from '../admissions.js';
import { CRITERIA, CRITERION_GUIDE, RUBRIC, type Criterion } from '../rubric.js';
import { FOCUS, TOTAL_QUESTIONS, covered as coveredBy, enoughEvidence, focusFor, nextCriterion, pickFallback } from './questions.js';
import { critique, describe, parseDraft, type Context, type Reaction } from './critique.js';
import { acceptSpec, composeAnswer, type AnswerInput, type Format, type Spec } from './formats.js';
import { PROMPT_VERSION, SYSTEM, TONES, userPrompt, type Tone } from './persona.js';
import { SAFETY_REPLY, isSensitive } from './safety.js';

const textOf = (a: Pick<ApplicationAnswer, 'answer'>) => {
  const v = a.answer as { text?: unknown } | null;
  return typeof v?.text === 'string' ? v.text : '';
};

export const ANSWER_MAX = 1500;

const rows = (applicationId: string) => prisma.applicationAnswer.findMany({ where: { application_id: applicationId }, orderBy: { position: 'asc' } });

/** True once any answer the applicant gave looks like it needs a person, not an interviewer. */
export const hasSensitiveAnswer = (answers: ApplicationAnswer[]) => answers.some((a) => isSensitive(textOf(a)));

export type Generated = { text: string; format: Format; spec: Spec | null };

/** A usable AI question: short, a real question, nothing that asks for contact details or links, and a valid format. */
export const acceptGenerated = (raw: string): Generated | null => {
  const d = parseDraft(raw);
  if (!d) return null;
  const t = d.question;
  if (t.length < 15 || t.length > 340 || !t.includes('?')) return null;
  if (/https?:|www\.|@|\d{7,}/i.test(t)) return null;
  const f = acceptSpec(d.spec.format, d.spec.raw);
  return f ? { text: t, ...f } : null;
};

/** Just the question text, for callers that do not care about its format. */
export const acceptQuestion = (raw: string): string | null => acceptGenerated(raw)?.text ?? null;

const aiAllowed = (answers: ApplicationAnswer[]) => config.admissionsAiEnabled && hasProviders() && !hasSensitiveAnswer(answers);

const signalsOf = (a: Pick<ApplicationAnswer, 'signals'>): string[] => (Array.isArray(a.signals) ? (a.signals as unknown[]).filter((x): x is string => typeof x === 'string') : []);
const evidenceOf = (answers: ApplicationAnswer[]) => answers.map((a) => ({ criterion: a.criterion, text: textOf(a), signals: signalsOf(a) }));

/** How they write, in plain words, so Alfred can match their register. This steers wording only and is never stored or scored. */
export const styleOf = (texts: string[]): string => {
  const t = texts.filter(Boolean);
  if (!t.length) return 'not enough yet';
  const avg = t.reduce((n, x) => n + x.trim().split(/\s+/).length, 0) / t.length;
  const notes = [avg < 7 ? 'very short answers' : avg > 40 ? 'long detailed answers' : 'medium answers'];
  if (/\p{Extended_Pictographic}|\b(lol|lmao|haha+)\b/iu.test(t.join(' '))) notes.push('uses emoji or laughs, jokes around');
  return notes.join('; ');
};

const NO_EXPERIENCE = /\b(haven'?t|have not|never|not yet|no)\s+(really\s+)?(built|made|created|done|started|worked on|had)\b|\bnothing (yet|built)\b|\bno projects?\b/i;

type Turn = { text: string; format: Format; spec: Spec | null; reaction: Reaction | null; mode: 'new' | 'follow_up'; shows: Criterion[] };

/**
 * One AI turn: a reaction to the last answer (optional) and the next question. The draft goes through the quality gate
 * (critique.ts). A hard problem earns one retry with the reasons spelled out, then the fixed bank takes over. A soft problem
 * only costs Alfred his reaction. Returns null when the bank should be used.
 */
const writeTurn = async (app: Application, answers: ApplicationAnswer[], position: number, focus: Criterion, covered: Criterion[], allowFormats: boolean): Promise<Turn | null> => {
  const texts = answers.map(textOf);
  const last = answers[answers.length - 1];
  const tone = (TONES as readonly string[]).includes(app.alfred_tone) ? (app.alfred_tone as Tone) : 'balanced';
  const uncovered = CRITERIA.filter((c) => !covered.includes(c)).length;
  const allowFollowUp = !!last && textOf(last).length >= 15 && TOTAL_QUESTIONS - answers.length - 1 >= uncovered && answers.slice(-2).filter((a) => a.kind === 'follow_up').length < 2;
  const noExperience = texts.some((t) => NO_EXPERIENCE.test(t));
  const ctx: Context = {
    past: answers.map((a) => ({ question: a.question_text, reaction: a.lead_in_text ? `${a.lead_in_type ?? ''} ${a.lead_in_text}` : null, answer: textOf(a) })),
    tone,
    serious: last?.lead_in_type === 'serious',
    noExperience,
    beginner: app.skill_level === 'beginner',
    allowFollowUp,
    first: position === 1,
  };
  const profile = { age: ageOn(app.birth_date), skill_level: app.skill_level, allowFormats, allowFollowUp, tone, style: styleOf(texts), noExperience };
  const history = answers.map((a) => ({ question: a.question_text, answer: textOf(a), reaction: a.lead_in_text }));
  const started = Date.now();

  type Got = { d: NonNullable<ReturnType<typeof parseDraft>>; f: NonNullable<ReturnType<typeof acceptSpec>> };
  const attempt = async (avoid: string[]): Promise<Got | null> => {
    const box: { got: Got | null } = { got: null };
    await generate(
      { system: SYSTEM, user: userPrompt(FOCUS[focus], history, app.interests, covered.map((c) => FOCUS[c].split(':')[0]!), profile, avoid) },
      (t) => {
        const d = parseDraft(t);
        const f = d ? acceptSpec(d.spec.format, d.spec.raw) : null;
        if (!d || !f) return false;
        box.got = { d, f };
        return true;
      },
      fetch,
      { maxTokens: 500, temperature: 0.8 },
    );
    return box.got;
  };

  const check = (g: Got) => {
    const problems = critique(g.d, ctx);
    if (!allowFormats && g.f.format !== 'text') problems.push({ level: 'hard', code: 'format', message: 'Cards are not allowed this turn; ask a typed question.' });
    return problems;
  };

  let g = await attempt([]);
  if (!g) return null;
  let problems = check(g);
  if (problems.some((p) => p.level === 'hard') && Date.now() - started < 8000) {
    const retry = await attempt(describe(problems)).catch(() => null);
    if (retry) {
      g = retry;
      problems = check(g);
    }
  }
  if (problems.some((p) => p.level === 'hard')) return null;
  // Soft problems cost Alfred his reaction, not the question.
  const reaction = problems.length === 0 ? g.d.reaction : null;
  return { text: g.d.question, format: g.f.format, spec: g.f.spec, reaction: position === 1 ? null : reaction, mode: g.d.mode, shows: g.d.shows };
};

/** Writes the next question (once). Safe to call twice: the second call returns the same row. */
export const ensureNextQuestion = async (app: Application): Promise<ApplicationAnswer | null> => {
  const answers = await rows(app.id);
  const open = answers.find((a) => textOf(a) === '');
  if (open) return open;
  if (answers.length >= TOTAL_QUESTIONS) return null;
  // Someone who told us something worrying is not put through more questions.
  if (hasSensitiveAnswer(answers)) return null;

  // Alfred stops once every criterion has real evidence and the minimum has been asked.
  const evidence = evidenceOf(answers);
  if (enoughEvidence(evidence)) return null;

  const position = answers.length + 1;
  const used = answers.map((a) => a.question_key);
  const age = ageOn(app.birth_date);
  const covered = coveredBy(evidence);
  // Taps and sliders are a change of pace, never the first question and never two in a row.
  const allowFormats = position > 1 && (answers[answers.length - 1]?.format ?? 'text') === 'text';
  let criterion: Criterion = focusFor(position, evidence);
  let question: { key: string; text: string; source: 'ai' | 'fallback'; format: string; spec: Spec | null; reaction: Reaction | null; kind: 'new' | 'follow_up' } | null = null;
  let shows: Criterion[] = [];

  if (aiAllowed(answers)) {
    try {
      const t = await writeTurn(app, answers, position, criterion, covered, allowFormats);
      if (t) {
        const follow = t.mode === 'follow_up' && position > 1;
        // A follow-up stays on the thread it is digging into.
        if (follow) criterion = (answers[answers.length - 1]!.criterion as Criterion | null) ?? criterion;
        question = { key: `ai-${position}`, text: t.text, source: 'ai', format: t.format, spec: t.spec, reaction: t.reaction, kind: follow ? 'follow_up' : 'new' };
        shows = t.shows;
      }
    } catch {
      // Every provider failed or answered badly: the fixed bank takes over.
    }
  }
  if (!question) {
    criterion = nextCriterion(position, evidence);
    const f = pickFallback(criterion, used, { age, interests: app.interests, allowFormats, preferFormats: allowFormats && (position === 3 || position === 5) });
    if (!f) return null;
    const format = f.format === 'scenario' ? 'text' : f.format;
    question = { key: f.key, text: f.text, source: 'fallback', format, spec: f.spec ?? null, reaction: null, kind: 'new' };
  }

  try {
    const last = answers[answers.length - 1];
    const [created] = await prisma.$transaction([
      prisma.applicationAnswer.create({
        data: {
          application_id: app.id,
          position,
          question_key: question.key,
          question_text: question.text,
          source: question.source,
          prompt_version: question.source === 'ai' ? PROMPT_VERSION : null,
          format: question.format,
          spec: question.spec ?? Prisma.JsonNull,
          criterion,
          kind: question.kind,
          lead_in_type: question.reaction?.type ?? null,
          lead_in_text: question.reaction?.text ?? null,
        },
      }),
      ...(last && question.source === 'ai' ? [prisma.applicationAnswer.update({ where: { id: last.id }, data: { signals: shows } })] : []),
    ]);
    return created;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return (await rows(app.id)).find((a) => a.position === position) ?? null;
    throw err;
  }
};

export type InterviewState = Awaited<ReturnType<typeof interviewState>>;

const specOf = (a: Pick<ApplicationAnswer, 'spec'>): Spec | null => (a.spec as Spec | null) ?? null;

export const leadIn = (a: Pick<ApplicationAnswer, 'lead_in_type' | 'lead_in_text'>) => (a.lead_in_text ? { type: a.lead_in_type ?? 'curious', text: a.lead_in_text } : null);

export const interviewState = async (app: Application) => {
  const answers = await rows(app.id);
  const answered = answers.filter((a) => textOf(a) !== '');
  const flagged = hasSensitiveAnswer(answers);
  // Alfred may stop before the maximum once he has heard enough about every quality.
  const complete = answered.length >= TOTAL_QUESTIONS || enoughEvidence(evidenceOf(answers));
  return {
    // The most Alfred will ask. He may finish sooner.
    total: TOTAL_QUESTIONS,
    tone: app.alfred_tone,
    answered: answered.length,
    complete,
    // Someone who flagged something may submit what they have, so a worried applicant is never trapped.
    can_submit: complete || (flagged && answered.length >= 1),
    questions: answers.map((a) => ({ position: a.position, alternatives_left: Math.max(0, MAX_ALTERNATIVES - a.alternatives), question: a.question_text, format: a.format, spec: specOf(a), kind: a.kind, lead_in: leadIn(a), answer: textOf(a) || null })),
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

/** Saves (or edits) an answer. Returns the fixed safety message if the answer needs a person, or a message if the answer does not fit the question. */
export const saveAnswer = async (app: Application, position: number, input: AnswerInput) => {
  const row = await prisma.applicationAnswer.findUnique({ where: { application_id_position: { application_id: app.id, position } } });
  if (!row) return null;
  const composed = composeAnswer(row.format, specOf(row), input);
  if (!composed.ok) return { invalid: composed.message, safety: null };
  const text = composed.text;
  const previous = textOf(row);
  if (previous === text) return { safety: isSensitive(text) ? SAFETY_REPLY : null };
  await prisma.$transaction([
    ...(previous ? [prisma.applicationAnswerRevision.create({ data: { answer_id: row.id, answer: row.answer ?? Prisma.JsonNull } })] : []),
    prisma.applicationAnswer.update({ where: { id: row.id }, data: { answer: composed.json as Prisma.InputJsonObject, revision: previous ? { increment: 1 } : undefined } }),
  ]);
  if (!isSensitive(text)) return { safety: null };

  await audit(null, 'application.safeguarding_flag', { type: 'application', id: app.id }, { reference: app.reference, position });
  // A rehearsal must never wake the safeguarding lead. The applicant still sees the same reply as a real one would get.
  if (await windowIsTest(app.window_id)) return { safety: SAFETY_REPLY };
  await alertSafeguarding(app.reference);
  return { safety: SAFETY_REPLY };
};

/** The most times an applicant may ask for a different question, per question, and skip questions overall. */
export const MAX_ALTERNATIVES = 2;
export const MAX_SKIPS = 2;

export type HelpAction = 'hint' | 'alternative' | 'skip';

/**
 * Help on the question still waiting for an answer. A hint is the same for everyone (the rubric's own examples), so it
 * can never leak how answers are judged. A different question and a skip swap the open question for another bank
 * question; skipping moves to a quality that has not been covered yet. Both are capped so the interview stays whole.
 */
export const helpWithQuestion = async (app: Application, position: number, action: HelpAction): Promise<{ hint?: string; error?: string } | null> => {
  const answers = await rows(app.id);
  const row = answers.find((a) => a.position === position);
  if (!row) return null;
  if (textOf(row) !== '') return { error: 'You have already answered this one. Edit your answer instead.' };
  const criterion = (row.criterion ?? 'initiative_action') as Criterion;

  if (action === 'hint') {
    const g = CRITERION_GUIDE[criterion];
    await prisma.applicationAnswer.update({ where: { id: row.id }, data: { hint_used: true } });
    return { hint: `Not sure where to start? Think of a time you did something like: ${g.examples.slice(0, 3).join('; ').toLowerCase()}. A small, real example is plenty.` };
  }

  const used = answers.map((a) => a.question_key);
  const age = ageOn(app.birth_date);
  const swap = async (target: Criterion) => {
    const f = pickFallback(target, used, { age, interests: app.interests, allowFormats: false });
    if (!f) return false;
    await prisma.applicationAnswer.update({ where: { id: row.id }, data: { question_key: f.key, question_text: f.text, source: 'fallback', prompt_version: null, format: 'text', spec: Prisma.JsonNull, criterion: target, kind: 'new', lead_in_type: null, lead_in_text: null, hint_used: false, alternatives: action === 'alternative' ? { increment: 1 } : 0 } });
    return true;
  };

  if (action === 'alternative') {
    if (row.alternatives >= MAX_ALTERNATIVES) return { error: 'You have used the different-question options for this one. Answer it your own way, or skip it.' };
    return (await swap(criterion)) ? {} : { error: 'There is no other question for this one right now.' };
  }

  if (app.alfred_skips >= MAX_SKIPS) return { error: `You can skip up to ${MAX_SKIPS} questions. Give this one a go, even a short answer helps.` };
  const have = new Set(coveredBy(evidenceOf(answers)));
  const options = CRITERIA.filter((c) => c !== criterion && !have.has(c) && !answers.some((a) => a.criterion === c)).sort((a, b) => RUBRIC[b] - RUBRIC[a]);
  for (const target of options) {
    if (await swap(target)) {
      await prisma.application.update({ where: { id: app.id }, data: { alfred_skips: { increment: 1 } } });
      return {};
    }
  }
  return { error: 'There is nothing else to skip to. Give this one a go.' };
};
