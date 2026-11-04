import type { Request, Response } from 'express';
import type { Application, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { ageOn, MIN_AGE, toDbDate } from '../lib/age.js';
import {
  RETENTION_MS,
  createWithReference,
  findNextWindow,
  findOpenWindow,
  newResumeToken,
  publicStatus,
  windowState,
} from '../lib/admissions.js';
import { sendApplicationLink, sendApplicationReceived, sendLookupMember, sendLookupNone } from '../lib/admissionsEmail.js';
import { needsGuardian } from '../lib/guardian.js';
import { createNotification } from '../lib/notify.js';
import type { ApplicantRequest } from '../middleware/applicant.js';

const NEUTRAL = { message: 'If that email can apply, we have sent a link to it. Check your inbox.' };

/** What the public may know about the intake. Never the internal target size. */
export const currentWindow = async (_req: Request, res: Response): Promise<void> => {
  const now = new Date();
  const open = await findOpenWindow(now);
  if (open) {
    res.json({ state: 'open', window: pub(open), next_opens_at: null });
    return;
  }
  const next = await findNextWindow(now);
  res.json({ state: 'closed', window: null, next_opens_at: next ? next.opens_at.toISOString() : null });
};

const pub = (w: { id: string; opens_at: Date; closes_at: Date; decisions_publish_at: Date }) => ({
  id: w.id,
  opens_at: w.opens_at.toISOString(),
  closes_at: w.closes_at.toISOString(),
  decisions_publish_at: w.decisions_publish_at.toISOString(),
});

export const requestReminder = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body as { email: string };
  const next = await findNextWindow();
  const window_id = next?.id ?? null;
  const existing = await prisma.applicationReminder.findFirst({ where: { email, window_id } });
  if (!existing) await prisma.applicationReminder.create({ data: { email, window_id } });
  res.json({ message: 'Done. We will email you when applications open.' });
};

export const startApplication = async (req: Request, res: Response): Promise<void> => {
  const b = req.body as {
    email: string; full_name: string; birth_date: string; country: string; city: string;
    whatsapp: string; school?: string | null; education_level: string;
  };

  // The age check comes first and stores nothing: no row, no log, no email.
  if (ageOn(b.birth_date) < MIN_AGE) {
    throw new HttpError(422, 'UNDER_AGE', `TeenovateX is for ages ${MIN_AGE} and up. Come back and apply when you are ${MIN_AGE}.`);
  }

  const window = await findOpenWindow();
  if (!window) throw new HttpError(409, 'APPLICATIONS_CLOSED', 'Applications are closed right now.');

  // Existing members and repeat visitors get the same answer as everyone else, so this
  // endpoint cannot be used to find out who has an account or an application.
  const member = await prisma.user.findUnique({ where: { email: b.email }, select: { id: true } });
  if (member) {
    res.status(202).json(NEUTRAL);
    return;
  }

  const link = newResumeToken();
  const existing = await prisma.application.findUnique({ where: { email_window_id: { email: b.email, window_id: window.id } } });
  // An unfinished draft from an earlier window moves forward instead of starting again.
  const carried = existing ?? (await prisma.application.findFirst({ where: { email: b.email, status: 'draft' }, orderBy: { created_at: 'desc' } }));

  if (carried) {
    await prisma.application.update({
      where: { id: carried.id },
      data: { window_id: carried.status === 'draft' ? window.id : carried.window_id, resume_token_hash: link.hash, resume_expires_at: link.expires },
    });
  } else {
    await createWithReference((reference) =>
      prisma.application.create({
        data: {
          reference, window_id: window.id, email: b.email, full_name: b.full_name, birth_date: toDbDate(b.birth_date),
          country: b.country, city: b.city, whatsapp: b.whatsapp, school: b.school ?? null, education_level: b.education_level,
          interests: [], current_skills: [], learning_goals: [],
          resume_token_hash: link.hash, resume_expires_at: link.expires,
        },
      })
    );
    // A reapplication restarts the clock on any earlier declined record.
    await prisma.application.updateMany({ where: { email: b.email, status: 'declined' }, data: { retention_delete_at: null } });
  }

  try {
    await sendApplicationLink(b.email, link.token);
  } catch (err) {
    console.error('Application link email failed:', err);
  }
  res.status(202).json(NEUTRAL);
};

/**
 * "Where do I stand?" The page always gets the same answer, whoever asks and whatever we hold. The real
 * answer goes only to the inbox: a member is pointed to login, an applicant gets a fresh link to their
 * own application, anyone else is told there is nothing. Proving the inbox is the proof of ownership.
 */
export const lookupStatus = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body as { email: string };
  try {
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      await sendLookupMember(email);
    } else {
      const latest = await prisma.application.findFirst({ where: { email, status: { not: 'withdrawn' } }, orderBy: { created_at: 'desc' } });
      if (latest) {
        const link = newResumeToken();
        await prisma.application.update({ where: { id: latest.id }, data: { resume_token_hash: link.hash, resume_expires_at: link.expires } });
        await sendApplicationLink(email, link.token);
      } else {
        await sendLookupNone(email);
      }
    }
  } catch (err) {
    console.error('Status lookup failed:', err);
  }
  res.status(202).json(NEUTRAL);
};

const view = async (app: Application) => {
  const window = await prisma.applicationWindow.findUniqueOrThrow({ where: { id: app.window_id } });
  const status = publicStatus(app, window);
  const consent = status === 'accepted' && needsGuardian(app.birth_date) ? await prisma.guardianConsent.findUnique({ where: { application_id: app.id } }) : null;
  return {
    guardian: status === 'accepted' ? { required: needsGuardian(app.birth_date), status: consent ? (consent.status === 'pending' && consent.expires_at <= new Date() ? 'expired' : consent.status) : 'not_requested' } : null,
    reference: app.reference,
    status: publicStatus(app, window),
    email: app.email,
    full_name: app.full_name,
    birth_date: app.birth_date.toISOString().slice(0, 10),
    country: app.country, city: app.city, whatsapp: app.whatsapp, school: app.school, education_level: app.education_level,
    interests: app.interests, skill_level: app.skill_level, skill_level_note: app.skill_level_note,
    current_skills: app.current_skills, learning_goals: app.learning_goals,
    portfolio_url: app.portfolio_url, github_url: app.github_url, linkedin_url: app.linkedin_url,
    clarifications: (await prisma.applicationClarification.findMany({ where: { application_id: app.id }, orderBy: { created_at: 'asc' } })).map((c) => ({ id: c.id, question: c.question, response: c.response, status: c.status, due_at: c.due_at.toISOString() })),
    submitted_at: app.submitted_at?.toISOString() ?? null,
    editable: app.status === 'draft' || (app.status === 'submitted' && !app.locked_at),
    window: { ...pub(window), state: windowState(window) },
  };
};

/** A draft whose window has closed moves to the open one, so nothing the applicant wrote is lost. */
const carryForward = async (app: Application): Promise<Application> => {
  if (app.status !== 'draft') return app;
  const open = await findOpenWindow();
  if (!open || open.id === app.window_id) return app;
  const clash = await prisma.application.findUnique({ where: { email_window_id: { email: app.email, window_id: open.id } } });
  if (clash) return app;
  return prisma.application.update({ where: { id: app.id }, data: { window_id: open.id } });
};

export const getMyApplication = async (req: ApplicantRequest, res: Response): Promise<void> => {
  res.json(await view(await carryForward(req.application!)));
};

export const updateDraft = async (req: ApplicantRequest, res: Response): Promise<void> => {
  const app = await carryForward(req.application!);
  if (!(app.status === 'draft' || (app.status === 'submitted' && !app.locked_at))) {
    throw new HttpError(409, 'APPLICATION_LOCKED', 'This application is being reviewed and can no longer be edited.');
  }
  const { birth_date, ...rest } = req.body as Record<string, unknown> & { birth_date?: string };
  if (birth_date !== undefined && ageOn(birth_date) < MIN_AGE) {
    throw new HttpError(422, 'UNDER_AGE', `TeenovateX is for ages ${MIN_AGE} and up.`);
  }
  const updated = await prisma.application.update({
    where: { id: app.id },
    data: { ...(rest as Prisma.ApplicationUpdateInput), ...(birth_date !== undefined && { birth_date: toDbDate(birth_date) }) },
  });
  res.json(await view(updated));
};

export const submitApplication = async (req: ApplicantRequest, res: Response): Promise<void> => {
  const app = await carryForward(req.application!);
  if (app.status !== 'draft') throw new HttpError(409, 'ALREADY_SUBMITTED', 'This application was already submitted.');
  const window = await prisma.applicationWindow.findUniqueOrThrow({ where: { id: app.window_id } });
  // Closing is strict: the clock on our server decides, never the applicant's browser.
  if (windowState(window) !== 'open') throw new HttpError(409, 'APPLICATIONS_CLOSED', 'Applications are closed. Your draft is saved for the next window.');
  if (app.interests.length === 0) throw new HttpError(422, 'INCOMPLETE', 'Pick at least one interest before submitting.');

  const updated = await prisma.application.update({ where: { id: app.id }, data: { status: 'submitted', submitted_at: new Date() } });
  try {
    await sendApplicationReceived(updated.email, updated.reference);
  } catch (err) {
    console.error('Application receipt email failed:', err);
  }
  const admins = await prisma.user.findMany({ where: { role: 'admin' }, select: { id: true } });
  await Promise.all(admins.map((a) => createNotification(a.id, 'application', `New application ${updated.reference}`, { link: '/admin/applications' })));
  res.json({ ...(await view(updated)), message: 'Submitted. This is not an acceptance: results are released on the decision date.' });
};

export const withdrawApplication = async (req: ApplicantRequest, res: Response): Promise<void> => {
  const app = req.application!;
  if (app.status === 'withdrawn' || app.status === 'declined') throw new HttpError(409, 'NOT_WITHDRAWABLE', 'This application cannot be withdrawn.');
  const updated = await prisma.application.update({
    where: { id: app.id },
    data: { status: 'withdrawn', withdrawn_at: new Date(), retention_delete_at: new Date(Date.now() + RETENTION_MS) },
  });
  res.json({ ...(await view(updated)), message: 'Withdrawn. You can apply again in the next window.' });
};

export const replyToClarification = async (req: ApplicantRequest, res: Response): Promise<void> => {
  const app = req.application!;
  const c = await prisma.applicationClarification.findFirst({ where: { id: String(req.params.id), application_id: app.id } });
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Question not found');
  if (c.status !== 'open') throw new HttpError(409, 'ALREADY_ANSWERED', 'This question was already answered');
  if (c.due_at < new Date()) throw new HttpError(409, 'CLARIFICATION_EXPIRED', 'The time to answer this question has passed');
  const { response } = req.body as { response: string };
  await prisma.applicationClarification.update({ where: { id: c.id }, data: { response, responded_at: new Date(), status: 'answered' } });
  res.json({ message: 'Thanks, your reply was sent to the reviewer.' });
};
