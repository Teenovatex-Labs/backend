import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';

export const getNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  const notifications = await prisma.notification.findMany({
    where: { user_id: req.userId },
    orderBy: { created_at: 'desc' },
    take: 50,
  });
  res.json(notifications);
};

export const markAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const notif = await prisma.notification.findUnique({ where: { id } });

  if (!notif || notif.user_id !== req.userId) {
    res.status(404).json({ error: 'Notification not found', code: 'NOT_FOUND' });
    return;
  }

  await prisma.notification.update({ where: { id }, data: { read: true } });
  res.json({ message: 'Marked as read' });
};

export const markAllAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  await prisma.notification.updateMany({
    where: { user_id: req.userId },
    data: { read: true },
  });
  res.json({ message: 'All notifications marked as read' });
};
