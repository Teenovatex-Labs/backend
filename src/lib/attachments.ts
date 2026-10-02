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
