import type { Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { pushEnabled } from '../lib/push.js';

export const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'Push endpoints must be https'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(5).max(100) }),
});

const MAX_DEVICES = 10;

export const publicKey = (_req: AuthRequest, res: Response): void => {
  res.json({ enabled: pushEnabled, key: pushEnabled ? config.push.publicKey : null });
};

export const subscribe = async (req: AuthRequest, res: Response): Promise<void> => {
  const { endpoint, keys } = req.body as z.infer<typeof subscribeSchema>;
  const userId = req.userId!;
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { user_id: userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: (req.headers['user-agent'] as string | undefined) ?? null },
    update: { user_id: userId, p256dh: keys.p256dh, auth: keys.auth },
  });
  // Keep the newest few devices only.
  const all = await prisma.pushSubscription.findMany({ where: { user_id: userId }, orderBy: { created_at: 'desc' }, select: { id: true } });
  if (all.length > MAX_DEVICES) await prisma.pushSubscription.deleteMany({ where: { id: { in: all.slice(MAX_DEVICES).map((s) => s.id) } } });
  res.status(201).json({ message: 'Notifications are on for this device' });
};

export const unsubscribe = async (req: AuthRequest, res: Response): Promise<void> => {
  const { endpoint } = req.body as { endpoint?: string };
  if (endpoint) await prisma.pushSubscription.deleteMany({ where: { user_id: req.userId, endpoint } });
  res.json({ message: 'Notifications are off for this device' });
};
