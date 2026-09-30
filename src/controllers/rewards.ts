import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { awardPointsTx } from '../lib/points.js';
import { BADGES, checkBadgesQuietly } from '../lib/badges.js';
import { todaysQuest } from '../lib/quests.js';

export const myBadges = async (req: AuthRequest, res: Response): Promise<void> => {
  const earned = await prisma.userBadge.findMany({ where: { user_id: req.userId } });
  const when = new Map(earned.map((b) => [b.key, b.awarded_at]));
  res.json({ badges: BADGES.map((b) => ({ ...b, earned: when.has(b.key), awarded_at: when.get(b.key) ?? null })) });
};

export const getQuest = async (req: AuthRequest, res: Response): Promise<void> => {
  const q = await todaysQuest(req.userId!);
  res.json({ key: q.quest.key, title: q.quest.title, description: q.quest.description, goal: q.quest.goal, points: q.quest.points, progress: q.progress, complete: q.complete, claimed: q.claimed, resets_at: q.resets_at });
};

export const claimQuest = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const q = await todaysQuest(userId);
  if (!q.complete) throw new HttpError(400, 'NOT_DONE', "You haven't finished today's quest yet");
  if (q.claimed) throw new HttpError(409, 'ALREADY_CLAIMED', "You've already claimed today's reward");

  try {
    await prisma.$transaction(async (tx) => {
      // The primary key (member, day) makes a double claim impossible even if two requests race.
      await tx.questClaim.create({ data: { user_id: userId, day: q.day, key: q.quest.key } });
      await awardPointsTx(tx, userId, 'quest', q.quest.points, `Daily quest: ${q.quest.title}`);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new HttpError(409, 'ALREADY_CLAIMED', "You've already claimed today's reward");
    throw err;
  }
  checkBadgesQuietly(userId);
  res.json({ claimed: true, points_awarded: q.quest.points });
};
