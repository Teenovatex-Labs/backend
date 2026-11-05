import sharp from 'sharp';
import { prisma } from '../db.js';
import { HttpError } from './errors.js';

export const ATTACHMENT_MIN_ACCOUNT_AGE_MS = 7 * 86_400_000;
export const ATTACHMENTS_PER_DAY = 5;
const MAX_EDGE = 1600;

/**
 * Decodes the upload as a real image (the declared type is not trusted), fixes its rotation, shrinks
 * it, and writes it out fresh. Re-encoding drops everything the camera or phone stored in the file,
 * including GPS location.
 */
export async function cleanImage(buffer: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  try {
    const { data, info } = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new HttpError(400, 'INVALID_IMAGE', "That file isn't a valid image");
  }
}

/** Who may send an image: an established member in good standing, within a small daily limit. */
export async function assertCanSendImage(userId: string, now: Date = new Date()): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { created_at: true, suspended_until: true } });
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');
  if (now.getTime() - user.created_at.getTime() < ATTACHMENT_MIN_ACCOUNT_AGE_MS) {
    throw new HttpError(403, 'ACCOUNT_TOO_NEW', 'You can send images once your account is a week old.');
  }
  if (user.suspended_until && user.suspended_until > now) {
    throw new HttpError(403, 'SUSPENDED', "You can't send images while your account is suspended.");
  }
  const openReports = await prisma.report.count({ where: { target_user_id: userId, status: 'open' } });
  if (openReports > 0) throw new HttpError(403, 'UNDER_REVIEW', "Images are paused while a moderator reviews a report about your account.");
  const today = await prisma.messageAttachment.count({ where: { uploader_id: userId, created_at: { gt: new Date(now.getTime() - 86_400_000) } } });
  if (today >= ATTACHMENTS_PER_DAY) throw new HttpError(429, 'IMAGE_LIMIT', `You can send ${ATTACHMENTS_PER_DAY} images a day.`);
}

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

// Features that let a PDF run code, open things on its own or hide other files inside it.
const RISKY_PDF = /\/(JavaScript|JS|OpenAction|AA|Launch|EmbeddedFiles?|RichMedia|XFA|SubmitForm|ImportData)\b/;

/**
 * Hardening, not antivirus. The file must really be a PDF and must not use features that run code or open
 * things by themselves. Names hidden inside compressed object streams can slip past a text check, which is why
 * reviewers only download these files and never open them in the browser.
 */
export function checkPdf(buffer: Buffer): void {
  const bad = (m: string) => new HttpError(400, 'INVALID_PDF', m);
  if (buffer.length === 0 || buffer.length > MAX_PDF_BYTES) throw bad('A PDF must be under 10 MB.');
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw bad("That file isn't a PDF.");
  if (!buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1').includes('%%EOF')) throw bad('That PDF looks damaged. Try saving it again.');
  if (RISKY_PDF.test(buffer.toString('latin1'))) throw bad('That PDF has interactive parts we cannot accept. Export it as a plain PDF and try again.');
}
