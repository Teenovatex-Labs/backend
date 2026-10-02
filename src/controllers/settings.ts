import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { verifyGoogleToken } from '../lib/google.js';
import { describeDevice } from '../lib/device.js';
import { describeLocation } from '../lib/geo.js';
import { deletePrivateImage } from '../middleware/upload.js';
import { hashToken } from '../lib/tokens.js';

export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  const { current_password, new_password } = req.body as {
    current_password?: string;
    new_password: string;
  };

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }

  if (user.password_hash) {
    // Already has one (email/password account, or a Google account that
    // added one before) — must prove they know it.
    if (!current_password || !(await bcrypt.compare(current_password, user.password_hash))) {
      res.status(400).json({ error: 'Current password is incorrect', code: 'INVALID_PASSWORD' });
      return;
    }
  }
  // else: Google-only account setting its first password — nothing to
  // confirm yet, current_password (if sent) is ignored.

  await prisma.user.update({
    where: { id: req.userId },
    data: { password_hash: await bcrypt.hash(new_password, 12) },
  });

  res.json({ message: user.password_hash ? 'Password updated' : 'Password set' });
};

const currentSessionId = async (userId: string, refreshToken: unknown): Promise<string | null> => {
  if (typeof refreshToken !== 'string' || refreshToken.length < 10) return null;
  const h = hashToken(refreshToken);
  const s = await prisma.session.findFirst({ where: { user_id: userId, OR: [{ token_hash: h }, { prev_token_hash: h }] }, select: { id: true } });
  return s?.id ?? null;
};

export const getSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  const sessions = await prisma.session.findMany({
    where: { user_id: req.userId },
    select: { id: true, device_info: true, ip: true, last_active: true, created_at: true },
    orderBy: { last_active: 'desc' },
  });
  res.json(
    await Promise.all(
      sessions.map(async ({ device_info, ...s }) => ({ ...s, device_info, device: describeDevice(device_info), location: await describeLocation(s.ip) })),
    ),
  );
};

/** Which of the member's sessions is the one making this request, found from their own refresh token. */
export const whichSession = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ id: await currentSessionId(req.userId!, (req.body as { refresh_token?: string }).refresh_token) });
};

/** Signs out every device except the one making the request. */
export const revokeOtherSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  const keep = await currentSessionId(req.userId!, (req.body as { refresh_token?: string }).refresh_token);
  if (!keep) {
    res.status(400).json({ error: "Couldn't tell which device this is. Sign in again and retry.", code: 'UNKNOWN_SESSION' });
    return;
  }
  const { count } = await prisma.session.deleteMany({ where: { user_id: req.userId, id: { not: keep } } });
  res.json({ message: 'Signed out other devices', count });
};

export const revokeSession = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const session = await prisma.session.findUnique({ where: { id } });

  if (!session || session.user_id !== req.userId) {
    res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
    return;
  }

  await prisma.session.delete({ where: { id } });
  res.json({ message: 'Session revoked' });
};

export const updateNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  const { email_notifications, vote_alerts, contest_updates, public_profile, ai_chat } = req.body as {
    email_notifications?: boolean;
    vote_alerts?: boolean;
    contest_updates?: boolean;
    public_profile?: boolean;
    ai_chat?: boolean;
  };
  // Turning the AI on is a consent: remember when. Turning it off clears it.
  const consent = ai_chat === undefined ? {} : { ai_chat, ai_consented_at: ai_chat ? new Date() : null };

  const updated = await prisma.userSettings.upsert({
    where: { user_id: req.userId! },
    create: {
      user_id: req.userId!,
      ...(email_notifications !== undefined && { email_notifications }),
      ...(vote_alerts !== undefined && { vote_alerts }),
      ...(contest_updates !== undefined && { contest_updates }),
      ...(public_profile !== undefined && { public_profile }),
      ...consent,
    },
    update: {
      ...(email_notifications !== undefined && { email_notifications }),
      ...(vote_alerts !== undefined && { vote_alerts }),
      ...(contest_updates !== undefined && { contest_updates }),
      ...(public_profile !== undefined && { public_profile }),
      ...consent,
    },
  });

  res.json(updated);
};

export const deleteAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  const { password, id_token } = req.body as { password?: string; id_token?: string };

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }

  if (user.password_hash) {
    if (!password || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(400).json({ error: 'Incorrect password', code: 'INVALID_PASSWORD' });
      return;
    }
  } else {
    // Google-only account: there is no password to check, so ask Google to vouch for them again.
    const google = id_token ? await verifyGoogleToken(id_token) : null;
    if (!google || !user.google_id || google.sub !== user.google_id) {
      res.status(400).json({ error: 'Confirm with Google to delete your account', code: 'GOOGLE_CONFIRMATION_REQUIRED' });
      return;
    }
  }

  const files = await prisma.messageAttachment.findMany({ where: { uploader_id: req.userId, escalated: false }, select: { public_id: true } });
  await Promise.all(files.map((f) => deletePrivateImage(f.public_id)));
  await prisma.user.delete({ where: { id: req.userId } });
  res.json({ message: 'Account deleted' });
};
