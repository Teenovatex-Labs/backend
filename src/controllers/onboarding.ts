import type { Response } from 'express';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import { CONFIRMABLE, INTRO_MIN, STEPS, stepLink, suggestBio, type StepKey } from '../lib/onboarding.js';
import type { AuthRequest } from '../middleware/auth.js';

const state = async (userId: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { membership_status: true, onboarding_due_at: true, bio: true, intro: true, full_name: true } });
  const done = new Set((await prisma.onboardingProgress.findMany({ where: { user_id: userId } })).map((p) => p.step));
  const steps = STEPS.map((s) => ({
    key: s.key, title: s.title, required: s.required, link: stepLink(s.key),
    done: s.key === 'profile' ? (user.bio ?? '').trim().length >= 10 : s.key === 'intro' ? (user.intro ?? '').trim().length >= INTRO_MIN : done.has(s.key),
    self_reported: s.kind === 'confirm',
  }));
  const complete = steps.filter((s) => s.required).every((s) => s.done);
  const due = user.onboarding_due_at;
  return {
    status: user.membership_status,
    due_at: due?.toISOString() ?? null,
    overdue: user.membership_status === 'onboarding' && !!due && due < new Date(),
    steps,
    complete,
    intro: user.intro,
    // Ready to paste into the WhatsApp group.
    whatsapp_text: user.intro ? `Hi everyone, I'm ${user.full_name.split(' ')[0]}. ${user.intro}` : null,
  };
};

/** Moves an onboarding member to active once every required step is done. */
const activateIfDone = async (userId: string) => {
  const s = await state(userId);
  if (s.status !== 'onboarding' || !s.complete) return s;
  const moved = await prisma.user.updateMany({ where: { id: userId, membership_status: 'onboarding' }, data: { membership_status: 'active', status_changed_at: new Date(), onboarding_due_at: null } });
  if (moved.count === 1) await prisma.user.updateMany({ where: { id: userId, intro: { not: null } }, data: { intro_published_at: new Date() } });
  if (moved.count === 1) await prisma.membershipEvent.create({ data: { user_id: userId, from_status: 'onboarding', to_status: 'active', reason: 'Finished onboarding' } });
  return state(userId);
};

export const getOnboarding = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await activateIfDone(req.userId!));
};

export const confirmStep = async (req: AuthRequest, res: Response): Promise<void> => {
  const step = String(req.params.step);
  if (!CONFIRMABLE.includes(step)) throw new HttpError(404, 'UNKNOWN_STEP', 'That step cannot be confirmed here.');
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { membership_status: true } });
  if (me.membership_status !== 'onboarding') throw new HttpError(409, 'NOT_ONBOARDING', 'You have already finished onboarding.');
  await prisma.onboardingProgress.upsert({ where: { user_id_step: { user_id: req.userId!, step: step as StepKey } }, create: { user_id: req.userId!, step }, update: {} });
  res.json(await activateIfDone(req.userId!));
};

/** Gives a member more time. Capped, and always with a reason, so a deadline cannot quietly stop meaning anything. */
export const extendOnboarding = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { days, reason } = req.body as { days: number; reason: string };
  const user = await prisma.user.findUnique({ where: { id }, select: { membership_status: true, onboarding_due_at: true } });
  if (!user) throw new HttpError(404, 'NOT_FOUND', 'Member not found');
  if (user.membership_status !== 'onboarding') throw new HttpError(409, 'NOT_ONBOARDING', 'This member is not in onboarding.');
  const from = user.onboarding_due_at && user.onboarding_due_at > new Date() ? user.onboarding_due_at : new Date();
  const onboarding_due_at = new Date(from.getTime() + days * 86_400_000);
  await prisma.user.update({ where: { id }, data: { onboarding_due_at } });
  await audit(req.userId!, 'onboarding.extend', { type: 'user', id }, { days, reason });
  res.json({ onboarding_due_at: onboarding_due_at.toISOString() });
};

/** A bio to start from, built from the member's application. They can change every word before saving. */
export const profileSuggestion = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { email: true, full_name: true } });
  const application = await prisma.application.findFirst({ where: { email: user.email, status: 'accepted' }, orderBy: { submitted_at: 'desc' }, select: { interests: true, learning_goals: true } });
  res.json({ bio: suggestBio(user.full_name.split(' ')[0] ?? 'there', application?.interests ?? [], application?.learning_goals ?? []) });
};

/** Saves the member's own bio. This is the "approval" of the suggestion: nothing is set until they send it. */
export const saveBio = async (req: AuthRequest, res: Response): Promise<void> => {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { membership_status: true } });
  if (me.membership_status !== 'onboarding') throw new HttpError(409, 'NOT_ONBOARDING', 'You have already finished onboarding.');
  await prisma.user.update({ where: { id: req.userId }, data: { bio: (req.body as { bio: string }).bio } });
  res.json(await activateIfDone(req.userId!));
};

export const saveIntro = async (req: AuthRequest, res: Response): Promise<void> => {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { membership_status: true } });
  if (me.membership_status !== 'onboarding') throw new HttpError(409, 'NOT_ONBOARDING', 'You have already finished onboarding.');
  await prisma.user.update({ where: { id: req.userId }, data: { intro: (req.body as { intro: string }).intro } });
  res.json(await activateIfDone(req.userId!));
};
