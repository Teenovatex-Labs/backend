import type { MembershipStatus, Prisma } from '@prisma/client';
import { audit } from './audit.js';
import { HttpError } from './errors.js';
import { createNotification } from './notify.js';

/** Where each status can go next. `removed` is final: coming back means applying again. */
export const TRANSITIONS: Record<MembershipStatus, readonly MembershipStatus[]> = {
  onboarding: ['active', 'inactive', 'removed'],
  active: ['on_leave', 'inactive', 'alumni', 'removed'],
  on_leave: ['active', 'inactive', 'alumni', 'removed'],
  inactive: ['active', 'on_leave', 'alumni', 'removed'],
  alumni: ['active', 'removed'],
  removed: [],
};

export const REVIEW_DAYS_DEFAULT = Number(process.env.INACTIVE_REVIEW_DAYS ?? 14);

const MESSAGES: Partial<Record<MembershipStatus, string>> = {
  on_leave: 'Your membership is now on leave. Come back whenever you are ready.',
  alumni: 'You are now a TeenovateX alumnus. Thank you for everything you did here.',
  active: 'Your membership is active again.',
  inactive: 'Your membership is now marked inactive.',
};

/**
 * The one way a member's status changes. Checks the transition, records a MembershipEvent and an audit line,
 * and for `removed` ends every session so the person is signed out everywhere. Runs inside the caller's transaction.
 */
export const changeStatus = async (tx: Prisma.TransactionClient, userId: string, to: MembershipStatus, reason: string, actorId: string): Promise<MembershipStatus> => {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { membership_status: true } });
  if (!u) throw new HttpError(404, 'NOT_FOUND', 'Member not found');
  if (userId === actorId) throw new HttpError(403, 'SELF_CHANGE', 'You cannot change your own membership status.');
  if (!TRANSITIONS[u.membership_status].includes(to)) {
    throw new HttpError(409, 'BAD_TRANSITION', `A ${u.membership_status.replace('_', ' ')} member cannot become ${to.replace('_', ' ')}.`);
  }
  await tx.user.update({ where: { id: userId }, data: { membership_status: to, status_changed_at: new Date(), ...(to !== 'onboarding' && { onboarding_due_at: null }) } });
  await tx.membershipEvent.create({ data: { user_id: userId, from_status: u.membership_status, to_status: to, reason, actor_id: actorId } });
  await audit(actorId, 'membership.status', { type: 'user', id: userId }, { from: u.membership_status, to, reason }, tx);
  if (to === 'removed') await tx.session.deleteMany({ where: { user_id: userId } });
  return u.membership_status;
};

export const notifyStatus = async (userId: string, to: MembershipStatus) => {
  const message = MESSAGES[to];
  if (message) await createNotification(userId, 'membership', message, { link: '/home' });
};

