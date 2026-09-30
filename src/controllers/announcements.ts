import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const DAYS_VISIBLE = 14;

/** What members see: recent, not expired, newest first. */
export const listActive = async (_req: AuthRequest, res: Response): Promise<void> => {
  const now = new Date();
  const items = await prisma.announcement.findMany({
    where: { created_at: { gte: new Date(now.getTime() - DAYS_VISIBLE * 86_400_000) }, OR: [{ expires_at: null }, { expires_at: { gt: now } }] },
    orderBy: { created_at: 'desc' },
    take: 3,
    select: { id: true, title: true, body: true, link: true, created_at: true },
  });
  res.json({ announcements: items });
};

/** What staff see: everything, so they can retire an old one. */
export const listAll = async (_req: AuthRequest, res: Response): Promise<void> => {
  const items = await prisma.announcement.findMany({ orderBy: { created_at: 'desc' }, take: 50 });
  res.json({ announcements: items });
};

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  const { title, body, link, expires_at } = req.body as { title: string; body: string; link?: string; expires_at?: string };
  const item = await prisma.announcement.create({
    data: { title, body, link: link ?? null, expires_at: expires_at ? new Date(expires_at) : null, created_by: req.userId },
  });
  await audit(req.userId!, 'announcement.create', { type: 'announcement', id: item.id }, { title });
  res.status(201).json(item);
};

export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { count } = await prisma.announcement.deleteMany({ where: { id } });
  if (count === 0) throw new HttpError(404, 'NOT_FOUND', 'Announcement not found');
  await audit(req.userId!, 'announcement.delete', { type: 'announcement', id });
  res.json({ message: 'Announcement removed' });
};
