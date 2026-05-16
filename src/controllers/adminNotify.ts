import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';

const VALID_TYPES = ['announcement', 'warning', 'contest', 'feature'];


export const broadcastNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  const { type, message } = req.body as { type: string; message: string };

  
  const users = await prisma.user.findMany({ select: { id: true } });
  
  if (users.length === 0) {
    res.json({ message: 'No users to notify' });
    return;
  }

  await prisma.notification.createMany({
    data: users.map((u) => ({
      user_id: u.id,
      type,
      message,
    })),
  });

  res.json({ message: `Broadcast sent to ${users.length} users` });
};


export const userNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  const { userId } = req.params as { userId: string };
  const { type, message } = req.body as { type: string; message: string };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
  if (!user) {
    res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    return;
  }

  await prisma.notification.create({
    data: {
      user_id: user.id,
      type,
      message,
    },
  });

  res.json({ message: `Notification sent to ${user.username}` });
};
