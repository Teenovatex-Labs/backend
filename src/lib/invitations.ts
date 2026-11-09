import type { Prisma } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { needsGuardian } from './guardian.js';
import { hashToken } from './tokens.js';

export const ONBOARDING_DAYS = 7;

export type InviteProblem = 'CONSENT_REQUIRED' | 'INVITE_REQUIRED' | 'INVITE_TEST' | 'INVITE_INVALID' | 'INVITE_EMAIL_MISMATCH' | 'INVITE_USED';

export const inviteMessage: Record<InviteProblem, string> = {
  CONSENT_REQUIRED: 'A parent or guardian needs to confirm before you can create your account. Open your application to send them the request.',
  INVITE_REQUIRED: 'TeenovateX is invitation-only. Apply when the next window opens.',
  INVITE_TEST: 'This invitation came from a test admissions window, so it cannot open an account. That is the test working as intended.',
  INVITE_INVALID: 'This invitation link is not valid or has expired. Check the email we sent you, or contact us.',
  INVITE_EMAIL_MISMATCH: 'This invitation was sent to a different email address. Use the address we invited.',
  INVITE_USED: 'This invitation has already been used.',
};

/**
 * Looks the invitation up and checks it is usable for this email. Nothing is consumed here.
 * Returns the row, or the reason it cannot be used. `retryUserId` lets the person who already
 * used it for an unfinished sign-up (email not yet verified) pick up where they left off.
 */
export const checkInvitation = async (token: string | undefined, email: string, retryUserId?: string) => {
  if (!token) return { problem: 'INVITE_REQUIRED' as InviteProblem };
  const invite = await prisma.invitation.findUnique({ where: { token_hash: hashToken(token) } });
  if (!invite || invite.revoked_at || invite.expires_at <= new Date() || invite.role !== 'member') {
    return { problem: 'INVITE_INVALID' as InviteProblem };
  }
  if (invite.email.toLowerCase() !== email.toLowerCase()) return { problem: 'INVITE_EMAIL_MISMATCH' as InviteProblem };
  if (invite.used_at && invite.used_by !== retryUserId) return { problem: 'INVITE_USED' as InviteProblem };
  // Under the guardian age, the account stays locked until the guardian has confirmed.
  if (invite.application_id) {
    const app = await prisma.application.findUnique({ where: { id: invite.application_id }, select: { birth_date: true, window: { select: { is_test: true } }, consent: { select: { status: true, expires_at: true } } } });
    // A rehearsal's invitation can be walked through (that is the point) but never turned into an account.
    if (app?.window.is_test) return { problem: 'INVITE_TEST' as InviteProblem };
    if (app && needsGuardian(app.birth_date) && !(app.consent?.status === 'confirmed')) return { problem: 'CONSENT_REQUIRED' as InviteProblem };
  }
  return { invite };
};

/** Marks the invitation used, atomically, so two sign-ups with one link cannot both win. */
export const consumeInvitation = async (tx: Prisma.TransactionClient, inviteId: string, userId: string, alreadyUsedByUser: boolean) => {
  if (alreadyUsedByUser) return true;
  const { count } = await tx.invitation.updateMany({ where: { id: inviteId, used_at: null, revoked_at: null }, data: { used_at: new Date(), used_by: userId } });
  return count === 1;
};

/** What a brand-new invited member starts with: onboarding status and a 7-day clock. */
export const onboardingStart = (now = new Date()) => ({
  membership_status: 'onboarding' as const,
  status_changed_at: now,
  onboarding_due_at: new Date(now.getTime() + ONBOARDING_DAYS * 86_400_000),
});

export const gateIsOn = () => config.requireInvitation;
