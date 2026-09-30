import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { dayToDb, localDay } from '../lib/day.js';
import { AllProvidersFailed, hasProviders } from '../lib/pet/providers.js';
import { NAPPING, think } from '../lib/pet/brain.js';

const MAX_TEXT = 500;

const today = async (userId: string) => {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  return dayToDb(localDay(me?.timezone));
};

export const status = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const [settings, used] = await Promise.all([
    prisma.userSettings.findUnique({ where: { user_id: userId } }),
    prisma.petUsage.findUnique({ where: { user_id_day: { user_id: userId, day: await today(userId) } } }),
  ]);
  res.json({
    available: config.pet.enabled && hasProviders(),
    enabled_by_member: settings?.ai_chat ?? false,
    remaining_today: Math.max(0, config.pet.dailyLimit - (used?.count ?? 0)),
    daily_limit: config.pet.dailyLimit,
  });
};

export const brain = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const { text, page } = req.body as { text: string; page?: string };

  if (!config.pet.enabled || !hasProviders()) throw new HttpError(503, 'PET_NAPPING', NAPPING);

  // The member has to have switched this on themselves, after being told what it sends and where.
  const settings = await prisma.userSettings.findUnique({ where: { user_id: userId } });
  if (!settings?.ai_chat) throw new HttpError(403, 'AI_NOT_ENABLED', 'Alfred needs your OK before he uses AI. You can turn it on in Settings.');

  // Count the use first (atomically), so hitting the limit can't be dodged by racing requests.
  const day = await today(userId);
  const usage = await prisma.petUsage.upsert({
    where: { user_id_day: { user_id: userId, day } },
    create: { user_id: userId, day, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (usage.count > config.pet.dailyLimit) {
    await prisma.petUsage.update({ where: { user_id_day: { user_id: userId, day } }, data: { count: { decrement: 1 } } });
    throw new HttpError(429, 'PET_LIMIT', "I've done a lot of thinking for you today and need to rest my brain. Try again tomorrow, or use my quick commands.");
  }

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  try {
    // Only the words they typed, their username and the page they are on are sent. Never other
    // members' content, never email, never anything private.
    const result = await think({ text, username: me!.username, page });
    res.json({ reply: result.reply, intent: result.intent, remaining_today: Math.max(0, config.pet.dailyLimit - usage.count) });
  } catch (err) {
    // A failed attempt doesn't cost the member one of their daily uses.
    await prisma.petUsage.update({ where: { user_id_day: { user_id: userId, day } }, data: { count: { decrement: 1 } } }).catch(() => {});
    if (err instanceof AllProvidersFailed) throw new HttpError(503, 'PET_NAPPING', NAPPING);
    throw err;
  }
};
