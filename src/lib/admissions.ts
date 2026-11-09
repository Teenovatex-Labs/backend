import crypto from 'node:crypto';
import { Prisma, type Application, type ApplicationWindow } from '@prisma/client';
import { prisma } from '../db.js';
import { hashToken } from './tokens.js';

export const RESUME_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const RETENTION_MS = 183 * 24 * 60 * 60 * 1000; // about 6 months

export type WindowState = 'upcoming' | 'open' | 'closed';

/** Derived from the absolute times, so nothing has to flip a flag at the right moment. */
export const windowState = (w: Pick<ApplicationWindow, 'opens_at' | 'closes_at'>, now = new Date()): WindowState =>
  now < w.opens_at ? 'upcoming' : now < w.closes_at ? 'open' : 'closed';

// Test windows never count as "the" open or next window: the public, the reminders and the carry-forward of drafts only see real ones.
export const findOpenWindow = (now = new Date()) =>
  prisma.applicationWindow.findFirst({ where: { is_test: false, opens_at: { lte: now }, closes_at: { gt: now } }, orderBy: { opens_at: 'desc' } });

export const findNextWindow = (now = new Date()) =>
  prisma.applicationWindow.findFirst({ where: { is_test: false, opens_at: { gt: now } }, orderBy: { opens_at: 'asc' } });

/** The open test window behind a private link, or null. Wrong or missing key is the same answer. */
export const findTestWindow = (key: string | undefined | null, now = new Date()) =>
  key ? prisma.applicationWindow.findFirst({ where: { is_test: true, test_key: key, opens_at: { lte: now }, closes_at: { gt: now } } }) : Promise.resolve(null);

export const windowIsTest = async (window_id: string): Promise<boolean> =>
  (await prisma.applicationWindow.findUnique({ where: { id: window_id }, select: { is_test: true } }))?.is_test ?? false;

export const newTestKey = () => crypto.randomBytes(18).toString('hex');

/** A fresh link token. Only its hash is stored. */
export const newResumeToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token), expires: new Date(Date.now() + RESUME_TTL_MS) };
};

/** TX-2026-00024. Sequential per year; a clash from two simultaneous applicants just retries. */
export const createWithReference = async <T>(make: (reference: string) => Promise<T>, prefix: 'TX' | 'TEST' = 'TX'): Promise<T> => {
  const year = new Date().getUTCFullYear();
  for (let attempt = 0; attempt < 6; attempt++) {
    // Test applications have their own numbering, so rehearsals never leave gaps in the real sequence.
    const count = await prisma.application.count({ where: { reference: { startsWith: `${prefix}-${year}-` } } });
    const reference = `${prefix}-${year}-${String(count + 1 + attempt).padStart(5, '0')}`;
    try {
      return await make(reference);
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
  }
  throw new Error('Could not allocate an application reference');
};

/** Results stay private until the decision date: before then everything past "submitted" reads as under review. */
export const publicStatus = (app: Pick<Application, 'status' | 'published_at'>, window: Pick<ApplicationWindow, 'decisions_publish_at'>, now = new Date()) => {
  const decided = app.status === 'accepted' || app.status === 'declined' || app.status === 'waitlisted';
  if (decided && !(app.published_at && now >= window.decisions_publish_at)) return 'under_review';
  if (app.status === 'shortlisted') return 'under_review';
  return app.status;
};

export const INVITE_DAYS = 14;

/** A single-use invitation token. Only its hash is stored. */
export const newInvitation = () => {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token), expires: new Date(Date.now() + INVITE_DAYS * 86_400_000) };
};

export const OFFER_HOURS = 72;
