import type { Request, Response } from 'express';
import type { Prisma, ApplicationStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { ageOn } from '../lib/age.js';
import { can } from '../lib/permissions.js';
import { CRITERIA, CRITERION_GUIDE, INSUFFICIENT_EVIDENCE, RATING_GUIDE, RUBRIC, weightedScore, type Criterion, type Rating } from '../lib/rubric.js';
import { RETENTION_MS } from '../lib/admissions.js';
import { sendClarificationRequest } from '../lib/admissionsEmail.js';
import { summarise } from '../lib/alfred/summary.js';
import type { AuthRequest } from '../middleware/auth.js';

const PAGE = 20;
const CLARIFICATION_DAYS = 5;
const STATUS_FOR = { accept: 'accepted', decline: 'declined', waitlist: 'waitlisted', shortlist: 'shortlisted' } as const;
type Decision = keyof typeof STATUS_FOR;

const find = async (id: string) => {
  const app = await prisma.application.findUnique({ where: { id } });
  if (!app || app.status === 'draft') throw new HttpError(404, 'NOT_FOUND', 'Application not found');
  return app;
};

const summary = (a: { id: string; reference: string; status: ApplicationStatus; full_name: string; birth_date: Date; country: string; submitted_at: Date | null; claimed_by: string | null; window_id: string }) => ({
  id: a.id, reference: a.reference, status: a.status, full_name: a.full_name, age: ageOn(a.birth_date),
  country: a.country, submitted_at: a.submitted_at?.toISOString() ?? null, claimed_by: a.claimed_by, window_id: a.window_id,
});

export const listApplications = async (req: AuthRequest, res: Response): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(q.page) || 1);
  const where: Prisma.ApplicationWhereInput = {
    status: q.status ? (q.status as ApplicationStatus) : { not: 'draft' },
    ...(q.window_id && { window_id: q.window_id }),
    ...(q.claimed === 'mine' && { claimed_by: req.userId }),
    ...(q.claimed === 'none' && { claimed_by: null }),
  };
  const [rows, total] = await Promise.all([
    prisma.application.findMany({ where, orderBy: { submitted_at: 'asc' }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.application.count({ where }),
  ]);
  res.json({ items: rows.map(summary), total, page, pages: Math.ceil(total / PAGE) });
};

export const applicationStats = async (req: Request, res: Response): Promise<void> => {
  const window_id = typeof req.query.window_id === 'string' ? req.query.window_id : undefined;
  const grouped = await prisma.application.groupBy({ by: ['status'], where: { ...(window_id && { window_id }), status: { not: 'draft' } }, _count: { _all: true } });
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count._all;
  const unclaimed = await prisma.application.count({ where: { ...(window_id && { window_id }), status: 'submitted', claimed_by: null } });
  res.json({ counts, unclaimed });
};

/** A reviewer may see another reviewer's review only after submitting their own. */
/**
 * An optional reading aid for the reviewer. It is generated on request, never stored, never changes a score or a
 * status, and is labelled as machine-written. Each use is audited without keeping its text.
 */
export const summariseApplication = async (req: AuthRequest, res: Response): Promise<void> => {
  const app = await find(String(req.params.id));
  const answers = await prisma.applicationAnswer.findMany({ where: { application_id: app.id }, orderBy: { position: 'asc' } });
  const result = await summarise({ ...app, answers });
  await audit(req.userId!, 'application.summary', { type: 'application', id: app.id }, { ok: result.ok, ...(result.ok ? { prompt_version: result.prompt_version } : { reason: result.reason }) });
  if (!result.ok) {
    const message = { DISABLED: 'Summaries are switched off.', SENSITIVE: 'Read this application in full: something in it needs a person.', FAILED: 'A summary could not be made. Please read the answers directly.' }[result.reason];
    throw new HttpError(result.reason === 'FAILED' ? 502 : 409, `SUMMARY_${result.reason}`, message);
  }
  res.json({ summary: result.summary, machine_written: true, notice: 'Machine-written reading aid. It does not recommend or score anyone. Check it against the answers.' });
};

export const getApplication = async (req: AuthRequest, res: Response): Promise<void> => {
  const app = await find(String(req.params.id));
  const reviews = await prisma.applicationReview.findMany({ where: { application_id: app.id }, orderBy: { created_at: 'asc' } });
  const mine = reviews.find((r) => r.reviewer_id === req.userId);
  const mineDone = !!mine?.submitted_at;
  const shown = reviews.filter((r) => r.reviewer_id === req.userId || mineDone);
  const submitted = reviews.filter((r) => r.submitted_at);
  const disagree = submitted.length >= 2 && new Set(submitted.map((r) => r.recommendation)).size > 1;
  const [answers, attachments, clarifications] = await Promise.all([
    prisma.applicationAnswer.findMany({ where: { application_id: app.id }, orderBy: { position: 'asc' } }),
    prisma.applicationAttachment.findMany({ where: { application_id: app.id } }),
    prisma.applicationClarification.findMany({ where: { application_id: app.id }, orderBy: { created_at: 'asc' } }),
  ]);
  // Every view of an application is recorded.
  await audit(req.userId!, 'application.view', { type: 'application', id: app.id });
  res.json({
    ...summary(app),
    email: app.email, whatsapp: app.whatsapp, city: app.city, school: app.school, education_level: app.education_level,
    interests: app.interests, skill_level: app.skill_level, skill_level_note: app.skill_level_note,
    current_skills: app.current_skills, learning_goals: app.learning_goals,
    portfolio_url: app.portfolio_url, github_url: app.github_url, linkedin_url: app.linkedin_url,
    second_reviewer_id: app.second_reviewer_id, decided_by: app.decided_by, decision_note: app.decision_note,
    answers: answers.map((a) => ({ id: a.id, position: a.position, question: a.question_text, source: a.source, criterion: a.criterion, answer: a.answer })),
    attachments: attachments.map((a) => ({ id: a.id, kind: a.kind, url: a.url, filename: a.filename, scan_status: a.scan_status })),
    clarifications: clarifications.map((c) => ({ id: c.id, question: c.question, response: c.response, status: c.status, due_at: c.due_at.toISOString() })),
    reviews: shown.map((r) => ({ id: r.id, reviewer_id: r.reviewer_id, kind: r.kind, scores: r.scores, weighted_score: r.weighted_score, recommendation: r.recommendation, note: r.note, submitted_at: r.submitted_at?.toISOString() ?? null })),
    reviews_disagree: mineDone ? disagree : null,
    criteria: CRITERIA,
    rubric: { weights: RUBRIC, criteria: CRITERION_GUIDE, ratings: RATING_GUIDE, insufficient_evidence: INSUFFICIENT_EVIDENCE },
  });
};

export const claimApplication = async (req: AuthRequest, res: Response): Promise<void> => {
  const app = await find(String(req.params.id));
  // One atomic update, so two admins clicking at once cannot both win.
  const won = await prisma.application.updateMany({
    where: { id: app.id, status: 'submitted', claimed_by: null },
    data: { claimed_by: req.userId, claimed_at: new Date(), locked_at: new Date(), status: 'under_review' },
  });
  if (won.count === 0) throw new HttpError(409, 'ALREADY_CLAIMED', 'Someone else already claimed this application');
  await audit(req.userId!, 'application.claim', { type: 'application', id: app.id });
  res.json({ message: 'Claimed' });
};

const assertReviewer = (app: { claimed_by: string | null; second_reviewer_id: string | null }, userId: string) => {
  if (app.claimed_by !== userId && app.second_reviewer_id !== userId) {
    throw new HttpError(403, 'NOT_YOUR_REVIEW', 'Only the reviewer who claimed this application, or its second reviewer, can do that');
  }
};

export const saveReview = async (req: AuthRequest, res: Response): Promise<void> => {
  const app = await find(String(req.params.id));
  assertReviewer(app, req.userId!);
  const b = req.body as { scores: Record<Criterion, Rating>; recommendation: Decision; note?: string | null };
  const kind = app.second_reviewer_id === req.userId ? 'second' : 'first';
  const data = { kind, scores: b.scores, weighted_score: weightedScore(b.scores), recommendation: b.recommendation, note: b.note ?? null, submitted_at: new Date() } as const;
  const review = await prisma.applicationReview.upsert({
    where: { application_id_reviewer_id: { application_id: app.id, reviewer_id: req.userId! } },
    create: { application_id: app.id, reviewer_id: req.userId!, ...data },
    update: data,
  });
  await audit(req.userId!, 'application.review', { type: 'application', id: app.id });
  res.json({ id: review.id, weighted_score: review.weighted_score, message: 'Review saved. The weighted score is advice, not a decision.' });
};

export const assignSecondReviewer = async (req: AuthRequest, res: Response): Promise<void> => {
  const app = await find(String(req.params.id));
  assertReviewer(app, req.userId!);
  const { reviewer_id } = req.body as { reviewer_id: string };
  const reviewer = await prisma.user.findUnique({ where: { id: reviewer_id }, select: { role: true } });
  if (!reviewer || !can(reviewer.role, 'applications.review')) throw new HttpError(400, 'VALIDATION_ERROR', 'That person cannot review applications');
  if (reviewer_id === app.claimed_by) throw new HttpError(400, 'VALIDATION_ERROR', 'The second reviewer must be someone else');
  await prisma.application.update({ where: { id: app.id }, data: { second_reviewer_id: reviewer_id } });
  await audit(req.userId!, 'application.second_reviewer', { type: 'application', id: app.id }, { reviewer_id });
  res.json({ message: 'Second reviewer assigned' });
};

export const decide = async (req: AuthRequest, res: Response): Promise<void> => {
  const app = await find(String(req.params.id));
  if (app.claimed_by !== req.userId) throw new HttpError(403, 'NOT_YOUR_REVIEW', 'Only the reviewer who claimed this application can decide it');
  if (app.published_at) throw new HttpError(409, 'ALREADY_RELEASED', 'Results were released. Use a reversal with a reason.');
  const reviews = await prisma.applicationReview.findMany({ where: { application_id: app.id, submitted_at: { not: null } } });
  if (!reviews.some((r) => r.reviewer_id === req.userId)) throw new HttpError(409, 'REVIEW_REQUIRED', 'Save your own review before deciding');
  if (app.second_reviewer_id && !reviews.some((r) => r.reviewer_id === app.second_reviewer_id)) {
    throw new HttpError(409, 'SECOND_REVIEW_PENDING', 'Wait for the second reviewer to finish');
  }
  const b = req.body as { decision: Decision; note?: string | null; feedback?: string | null };
  await prisma.application.update({
    where: { id: app.id },
    data: { status: STATUS_FOR[b.decision], decided_by: req.userId, decided_at: new Date(), decision_note: b.note ?? null, decline_feedback: b.decision === 'decline' ? b.feedback ?? null : null },
  });
  await audit(req.userId!, 'application.decide', { type: 'application', id: app.id }, { decision: b.decision });
  res.json({ message: 'Decision saved. It stays private until the release date.' });
};

/** Changes a decision after the fact. Needs a written reason, is audited, and cancels any unused invitation. */
export const reverse = async (req: AuthRequest, res: Response): Promise<void> => {
  const app = await find(String(req.params.id));
  if (!['accepted', 'declined', 'waitlisted', 'shortlisted'].includes(app.status)) throw new HttpError(409, 'NOT_DECIDED', 'There is no decision to reverse');
  const b = req.body as { decision: Decision; reason: string };
  const to = STATUS_FOR[b.decision];
  if (to === app.status) throw new HttpError(400, 'VALIDATION_ERROR', 'That is already the decision');
  await prisma.$transaction(async (tx) => {
    await tx.application.update({
      where: { id: app.id },
      data: { status: to, decided_by: req.userId, decided_at: new Date(), retention_delete_at: to === 'declined' && app.published_at ? new Date(Date.now() + RETENTION_MS) : null },
    });
    if (app.status === 'accepted') await tx.invitation.updateMany({ where: { application_id: app.id, used_at: null, revoked_at: null }, data: { revoked_at: new Date() } });
    await audit(req.userId!, 'application.reverse', { type: 'application', id: app.id }, { from: app.status, to, reason: b.reason }, tx);
  });
  res.json({ message: 'Decision reversed and recorded' });
};

export const askClarification = async (req: AuthRequest, res: Response): Promise<void> => {
  const app = await find(String(req.params.id));
  assertReviewer(app, req.userId!);
  const { question } = req.body as { question: string };
  const c = await prisma.applicationClarification.create({
    data: { application_id: app.id, asked_by: req.userId!, question, due_at: new Date(Date.now() + CLARIFICATION_DAYS * 86_400_000) },
  });
  try {
    await sendClarificationRequest(app.email, CLARIFICATION_DAYS);
  } catch (err) {
    console.error('Clarification email failed:', err);
  }
  await audit(req.userId!, 'application.clarification', { type: 'application', id: app.id });
  res.status(201).json({ id: c.id, due_at: c.due_at.toISOString() });
};
