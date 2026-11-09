import { config } from '../config.js';
import { prisma } from '../db.js';

// Test admissions windows run on the live database, so they are fenced in:
//  - they can only email addresses that belong to the team (admins and moderators, with or without a +tag,
//    plus an optional allowlist), so a typo or a leaked link can never email a real applicant, guardian or lead;
//  - every email they send is subject-tagged [TEST];
//  - no invitation they create can open an account (see lib/invitations.ts);
//  - nothing about them reaches safeguarding leads or real counts.

/** you+test1@gmail.com and you@gmail.com are the same inbox. */
export const baseEmail = (email: string): string => {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  return `${local.split('+')[0]}@${domain}`;
};

export const TEST_EMAIL_HELP =
  'A test window can only email team addresses. Use your own address with a tag, for example you+applicant1@your-domain.com.';

export const testRecipientAllowed = async (email: string): Promise<boolean> => {
  const base = baseEmail(email);
  if (config.testEmailAllowlist.some((e) => baseEmail(e) === base)) return true;
  const team = await prisma.user.findMany({ where: { role: { in: ['admin', 'moderator'] } }, select: { email: true } });
  return team.some((u) => baseEmail(u.email) === base);
};
