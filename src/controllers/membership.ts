import type { Response } from 'express';
import type { MembershipStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import { REVIEW_DAYS_DEFAULT, changeStatus, notifyStatus } from '../lib/membership.js';
import { createNotification } from '../lib/notify.js';
import type { AuthRequest } from '../middleware/auth.js';

const DAY = 86_400_000;
const person = { select: { id: true, username: true, membership_status: true, last_login_at: true, created_at: true } } as const;

/** Usernames and activity only: no names, emails or birth dates are shown in admin member lists. */
export const listMembers = async (req: AuthRequest, res: Response): Promise<void> => {
  const status = String(req.query.status ?? '');
  const items = await prisma.user.findMany({
    where: ['onboarding', 'active', 'on_leave', 'inactive', 'alumni', 'removed'].includes(status) ? { membership_status: status as MembershipStatus } : {},
    select: { id: true, username: true, membership_status: true, status_changed_at: true, last_login_at: true },
    orderBy: { username: 'asc' }, take: 200,
  });
  res.json({ items });
};

export const setStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { status, reason } = req.body as { status: MembershipStatus; reason: string };
  await prisma.$transaction(async (tx) => {
    const open = await tx.inactivityReview.findFirst({ where: { user_id: id, status: 'open' } });
    if (open) throw new HttpError(409, 'REVIEW_OPEN', 'This member has an open inactivity review. Decide it first.');
    await changeStatus(tx, id, status, reason, req.userId!);
  });
  await notifyStatus(id, status);
  res.json({ status });
};

/** Members with no activity for N days. Candidates only: nothing here acts on them. */
export const inactivity = async (req: AuthRequest, res: Response): Promise<void> => {
  const days = Math.min(365, Math.max(7, Number(req.query.days ?? 60) || 60));
  const cutoff = new Date(Date.now() - days * DAY);
  const rows = await prisma.user.findMany({
    where: { membership_status: { in: ['active', 'on_leave'] }, role: 'member', OR: [{ last_login_at: { lt: cutoff } }, { last_login_at: null, created_at: { lt: cutoff } }] },
    select: { id: true, username: true, membership_status: true, last_login_at: true, created_at: true, inactivity_reviews: { where: { status: 'open' }, select: { id: true } } },
    orderBy: { last_login_at: 'asc' }, take: 200,
  });
  res.json({
    days,
    items: rows.map((r) => ({
      id: r.id, username: r.username, status: r.membership_status,
      last_seen: (r.last_login_at ?? r.created_at).toISOString(), under_review: r.inactivity_reviews.length > 0,
    })),
  });
};

export const startReview = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { reason, days } = req.body as { reason: string; days?: number };
  const u = await prisma.user.findUnique({ where: { id }, select: { membership_status: true } });
  if (!u) throw new HttpError(404, 'NOT_FOUND', 'Member not found');
  if (id === req.userId) throw new HttpError(403, 'SELF_CHANGE', 'You cannot review yourself.');
  if (!['active', 'on_leave', 'inactive'].includes(u.membership_status)) throw new HttpError(409, 'BAD_STATE', 'Only current members can be reviewed.');
  if (await prisma.inactivityReview.findFirst({ where: { user_id: id, status: 'open' } })) throw new HttpError(409, 'REVIEW_OPEN', 'A review is already open for this member.');
  const window = days ?? REVIEW_DAYS_DEFAULT;
  const review = await prisma.inactivityReview.create({ data: { user_id: id, reason, started_by: req.userId!, response_due_at: new Date(Date.now() + window * DAY) } });
  await audit(req.userId!, 'membership.review_start', { type: 'user', id }, { reason, days: window });
  await createNotification(id, 'membership', `We haven't seen you in a while. Please tell us how you are doing within ${window} days so we can keep your place.`, { link: '/membership/review' });
  res.status(201).json({ id: review.id, response_due_at: review.response_due_at.toISOString() });
};

/** Reviews still open, with how overdue each one is. Overdue never triggers anything by itself. */
export const listReviews = async (_req: AuthRequest, res: Response): Promise<void> => {
  const rows = await prisma.inactivityReview.findMany({ where: { status: 'open' }, orderBy: { response_due_at: 'asc' }, include: { user: person } });
  res.json({
    items: rows.map((r) => ({
      id: r.id, user_id: r.user_id, username: r.user.username, reason: r.reason, response_due_at: r.response_due_at.toISOString(),
      overdue: r.response_due_at < new Date(), member_response: r.member_response, responded_at: r.responded_at?.toISOString() ?? null,
    })),
  });
};

/** The admin's decision: stay, on leave, alumni or removed. Removing needs a clear written reason. */
export const decideReview = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { decision, reason } = req.body as { decision: 'active' | 'on_leave' | 'alumni' | 'removed'; reason: string };
  if (decision === 'removed' && reason.length < 20) throw new HttpError(422, 'REASON_REQUIRED', 'Explain in at least 20 characters why this member is being removed.');
  await prisma.$transaction(async (tx) => {
    const review = await tx.inactivityReview.findFirst({ where: { user_id: id, status: 'open' } });
    if (!review) throw new HttpError(404, 'NOT_FOUND', 'There is no open review for this member.');
    const lock = await tx.inactivityReview.updateMany({ where: { id: review.id, status: 'open' }, data: { status: 'decided', decision, decision_reason: reason, decided_by: req.userId, decided_at: new Date() } });
    if (lock.count === 0) throw new HttpError(409, 'REVIEW_CLOSED', 'This review was just decided.');
    const current = await tx.user.findUniqueOrThrow({ where: { id }, select: { membership_status: true } });
    // Staying active is a valid outcome even when the member is already active.
    if (!(decision === 'active' && current.membership_status === 'active')) await changeStatus(tx, id, decision, reason, req.userId!);
    await audit(req.userId!, 'membership.review_decide', { type: 'user', id }, { decision, reason }, tx);
  });
  await notifyStatus(id, decision);
  res.json({ decision });
};

export const myReview = async (req: AuthRequest, res: Response): Promise<void> => {
  const r = await prisma.inactivityReview.findFirst({ where: { user_id: req.userId, status: 'open' } });
  res.json({ review: r ? { id: r.id, response_due_at: r.response_due_at.toISOString(), responded: !!r.responded_at } : null });
};

export const respondToReview = async (req: AuthRequest, res: Response): Promise<void> => {
  const { message } = req.body as { message: string };
  const r = await prisma.inactivityReview.findFirst({ where: { user_id: req.userId, status: 'open' } });
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'There is nothing to respond to.');
  await prisma.inactivityReview.update({ where: { id: r.id }, data: { member_response: message, responded_at: new Date() } });
  await audit(req.userId!, 'membership.review_response', { type: 'user', id: req.userId! });
  res.json({ ok: true });
};
