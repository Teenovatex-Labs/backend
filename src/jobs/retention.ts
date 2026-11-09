import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { needsGuardian } from '../lib/guardian.js';
import { deletePrivateImage } from '../middleware/upload.js';
import { removePdf } from '../lib/pdfStore.js';

// Applicant data is kept only as long as it is needed. Two things end it early or on schedule:
//  - a declined application, 6 months after the decision (a reapplication resets the clock);
//  - an accepted under-age applicant whose guardian never confirmed (or withdrew) and whose invitation is no longer usable.
// Deletion removes the application, answers, attachments records, reviews and consent. The audit line keeps
// only the reference and the reason, never anything the applicant wrote.
// Not covered, because the policy is undefined: drafts that were never submitted.

export const deleteApplication = async (id: string, reference: string, reason: string, window_id?: string) => {
  const files = await prisma.applicationAttachment.findMany({ where: { application_id: id, public_id: { not: null } }, select: { public_id: true, kind: true } });
  await prisma.$transaction(async (tx) => {
    await tx.invitation.deleteMany({ where: { application_id: id, used_at: null } });
    await tx.application.delete({ where: { id } });
    await audit(null, 'application.purge', { type: 'application', id }, { reference, reason, ...(window_id && { window_id }) }, tx);
  });
  // Applicant photos go with the application; a missing file is not worth failing the purge over.
  for (const f of files) await (f.kind === 'pdf' ? removePdf : deletePrivateImage)(f.public_id!);
};

/** Removes a test window and everything in it. Refuses to touch a real window. */
export const purgeTestWindow = async (windowId: string, reason = 'test window purged'): Promise<number> => {
  const w = await prisma.applicationWindow.findUnique({ where: { id: windowId }, select: { is_test: true } });
  if (!w?.is_test) throw new Error('Only a test window can be purged');
  const apps = await prisma.application.findMany({ where: { window_id: windowId }, select: { id: true, reference: true } });
  for (const a of apps) await deleteApplication(a.id, a.reference, reason, windowId);
  await prisma.applicationReminder.deleteMany({ where: { window_id: windowId } });
  await prisma.applicationWindow.delete({ where: { id: windowId } });
  await audit(null, 'cohort.purge_test', { type: 'application_window', id: windowId }, { applications: apps.length, reason });
  return apps.length;
};

/** Test windows are rehearsals, so they do not linger: two weeks after one closes it is purged. */
export const TEST_WINDOW_KEEP_MS = 14 * 24 * 60 * 60 * 1000;

export async function runRetention(now: Date = new Date()): Promise<{ declined: number; consent: number; expired_consents: number; test_windows: number }> {
  // A pending confirmation that ran out of time is marked as such, so the record says what happened.
  const expired = await prisma.guardianConsent.updateMany({ where: { status: 'pending', expires_at: { lte: now } }, data: { status: 'expired' } });

  let declined = 0;
  const due = await prisma.application.findMany({ where: { status: 'declined', retention_delete_at: { lte: now } }, select: { id: true, reference: true, window_id: true } });
  for (const a of due) {
    await deleteApplication(a.id, a.reference, 'declined, retention period ended', a.window_id);
    declined++;
  }

  let consent = 0;
  const accepted = await prisma.application.findMany({
    where: { status: 'accepted', published_at: { not: null }, invitations: { none: { used_at: { not: null } } } },
    include: { consent: { select: { status: true } }, invitations: { select: { expires_at: true, revoked_at: true } } },
  });
  for (const a of accepted) {
    if (!needsGuardian(a.birth_date) || a.consent?.status === 'confirmed') continue;
    const usable = a.invitations.some((i) => !i.revoked_at && i.expires_at > now);
    if (usable) continue;
    await deleteApplication(a.id, a.reference, 'guardian confirmation not completed', a.window_id);
    consent++;
  }

  let test_windows = 0;
  const stale = await prisma.applicationWindow.findMany({ where: { is_test: true, closes_at: { lte: new Date(now.getTime() - TEST_WINDOW_KEEP_MS) } }, select: { id: true } });
  for (const w of stale) {
    await purgeTestWindow(w.id, 'test window expired');
    test_windows++;
  }
  return { declined, consent, expired_consents: expired.count, test_windows };
}

/** Starts the hourly scan. Returns a stop function. */
export function startRetention(intervalMs = 60 * 60_000): () => void {
  const tick = () => runRetention().catch((err) => console.error('Retention scan failed:', err));
  const first = setTimeout(tick, 30_000);
  const timer = setInterval(tick, intervalMs);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
