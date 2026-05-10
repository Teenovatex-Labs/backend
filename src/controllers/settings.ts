import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';

export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  const { current_password, new_password } = req.body as {
    current_password: string;
    new_password: string;
  };

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }

  if (!(await bcrypt.compare(current_password, user.password_hash))) {
    res.status(400).json({ error: 'Current password is incorrect', code: 'INVALID_PASSWORD' });
    return;
  }

  await prisma.user.update({
    where: { id: req.userId },
    data: { password_hash: await bcrypt.hash(new_password, 12) },
  });

  res.json({ message: 'Password updated' });
};

export const getSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  const sessions = await prisma.session.findMany({
    where: { user_id: req.userId },
    select: { id: true, device_info: true, ip: true, last_active: true, created_at: true },
    orderBy: { last_active: 'desc' },
  });
  res.json(sessions);
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
  const { email_notifications, vote_alerts, contest_updates, public_profile } = req.body as {
    email_notifications?: boolean;
    vote_alerts?: boolean;
    contest_updates?: boolean;
    public_profile?: boolean;
  };

  const updated = await prisma.userSettings.upsert({
    where: { user_id: req.userId! },
    create: {
      user_id: req.userId!,
      ...(email_notifications !== undefined && { email_notifications }),
      ...(vote_alerts !== undefined && { vote_alerts }),
      ...(contest_updates !== undefined && { contest_updates }),
      ...(public_profile !== undefined && { public_profile }),
    },
    update: {
      ...(email_notifications !== undefined && { email_notifications }),
      ...(vote_alerts !== undefined && { vote_alerts }),
      ...(contest_updates !== undefined && { contest_updates }),
      ...(public_profile !== undefined && { public_profile }),
    },
  });

  res.json(updated);
};

export const deleteAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  const { password } = req.body as { password: string };

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }

  if (!(await bcrypt.compare(password, user.password_hash))) {
    res.status(400).json({ error: 'Incorrect password', code: 'INVALID_PASSWORD' });
    return;
  }

  await prisma.user.delete({ where: { id: req.userId } });
  res.json({ message: 'Account deleted' });
};
