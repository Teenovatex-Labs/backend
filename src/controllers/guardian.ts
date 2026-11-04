import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { sendGuardianRequest } from '../lib/admissionsEmail.js';
import { CONSENT_TEXT, CONSENT_TEXT_VERSION, needsGuardian, newConsentToken } from '../lib/guardian.js';
import { HttpError } from '../lib/errors.js';
import { hashToken } from '../lib/tokens.js';
import type { ApplicantRequest } from '../middleware/applicant.js';

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? 'Your child';

/** Applicant asks us to contact a parent or guardian. Only after acceptance has been released. */
export const requestGuardian = async (req: ApplicantRequest, res: Response): Promise<void> => {
  const app = req.application!;
  const { parent_email } = req.body as { parent_email: string };
  if (app.status !== 'accepted' || !app.published_at) throw new HttpError(409, 'NOT_ACCEPTED', 'Guardian confirmation is requested once you have been accepted.');
  if (!needsGuardian(app.birth_date)) throw new HttpError(409, 'NOT_NEEDED', 'You do not need a parent or guardian to confirm.');
  if (parent_email.toLowerCase() === app.email.toLowerCase()) throw new HttpError(422, 'SAME_EMAIL', 'Use your parent or guardian’s own email address, not yours.');

  // The confirmation lives as long as the invitation it unlocks.
  const invite = await prisma.invitation.findFirst({ where: { application_id: app.id, used_at: null, revoked_at: null, expires_at: { gt: new Date() } }, orderBy: { created_at: 'desc' } });
  if (!invite) throw new HttpError(409, 'INVITE_EXPIRED', 'Your invitation has expired.');

  const existing = await prisma.guardianConsent.findUnique({ where: { application_id: app.id } });
  if (existing?.status === 'confirmed') throw new HttpError(409, 'ALREADY_CONFIRMED', 'Your guardian has already confirmed.');

  const t = newConsentToken();
  const data = { parent_email, token_hash: t.hash, text_version: CONSENT_TEXT_VERSION, status: 'pending' as const, requested_at: new Date(), expires_at: invite.expires_at, withdrawn_at: null, confirmed_at: null };
  await prisma.guardianConsent.upsert({ where: { application_id: app.id }, create: { application_id: app.id, ...data }, update: data });
  const days = Math.max(1, Math.ceil((invite.expires_at.getTime() - Date.now()) / 86_400_000));
  try {
    await sendGuardianRequest(parent_email, firstName(app.full_name), t.token, days);
  } catch (err) {
    console.error('Guardian email failed:', err);
  }
  res.status(202).json({ message: 'We have emailed your parent or guardian.', status: 'pending' });
};

const find = async (token: string) => {
  const c = await prisma.guardianConsent.findUnique({ where: { token_hash: hashToken(token) }, include: { application: { select: { full_name: true } } } });
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'This link is not valid.');
  return c;
};

/** What the guardian sees before deciding. Nothing about the application itself. */
export const showConsent = async (req: Request, res: Response): Promise<void> => {
  const c = await find(String(req.params.token));
  const expired = c.status === 'pending' && c.expires_at <= new Date();
  res.json({ child_first_name: firstName(c.application.full_name), status: expired ? 'expired' : c.status, text: CONSENT_TEXT, text_version: c.text_version, expires_at: c.expires_at.toISOString() });
};

export const confirmConsent = async (req: Request, res: Response): Promise<void> => {
  const c = await find(String(req.params.token));
  if (c.status === 'confirmed') { res.json({ status: 'confirmed' }); return; }
  if (c.status !== 'pending') throw new HttpError(409, 'NOT_PENDING', 'This request is no longer open.');
  // Atomic, and checks the deadline on our clock.
  const done = await prisma.guardianConsent.updateMany({ where: { id: c.id, status: 'pending', expires_at: { gt: new Date() } }, data: { status: 'confirmed', confirmed_at: new Date(), ip_hash: req.ip ? hashToken(req.ip) : null } });
  if (done.count === 0) throw new HttpError(409, 'EXPIRED', 'This request has expired. Ask your child to send a new one.');
  res.json({ status: 'confirmed' });
};

/** A guardian can take their confirmation back at any time. The invitation stops working; an existing account is paused. */
export const withdrawConsent = async (req: Request, res: Response): Promise<void> => {
  const c = await find(String(req.params.token));
  if (c.status === 'withdrawn') { res.json({ status: 'withdrawn' }); return; }
  await prisma.guardianConsent.update({ where: { id: c.id }, data: { status: 'withdrawn', withdrawn_at: new Date() } });
  await prisma.invitation.updateMany({ where: { application_id: c.application_id, used_at: null, revoked_at: null }, data: { revoked_at: new Date() } });
  const used = await prisma.invitation.findMany({ where: { application_id: c.application_id, used_by: { not: null } }, select: { used_by: true } });
  for (const u of used) {
    const user = await prisma.user.findUnique({ where: { id: u.used_by! }, select: { id: true, membership_status: true } });
    if (user && user.membership_status !== 'inactive' && user.membership_status !== 'removed') {
      await prisma.user.update({ where: { id: user.id }, data: { membership_status: 'inactive', status_changed_at: new Date() } });
      await prisma.membershipEvent.create({ data: { user_id: user.id, from_status: user.membership_status, to_status: 'inactive', reason: 'Guardian withdrew confirmation' } });
    }
  }
  await audit(null, 'guardian.withdraw', { type: 'application', id: c.application_id });
  res.json({ status: 'withdrawn' });
};
