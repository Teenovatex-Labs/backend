import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';

export const getMyPoints = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { points: true } });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }

  const activity = await prisma.pointsLog.findMany({
    where: { user_id: req.userId },
    orderBy: { created_at: 'desc' },
    take: 50,
  });

  const breakdown = {
    votes_received: activity
      .filter((a) => a.reason.toLowerCase().includes('vote'))
      .reduce((s, a) => s + a.points, 0),
    posts_tagged: activity
      .filter((a) => a.reason.toLowerCase().includes('tx'))
      .reduce((s, a) => s + a.points, 0),
    streak_bonus: activity
      .filter((a) => a.reason.toLowerCase().includes('streak') || a.reason.toLowerCase().includes('login'))
      .reduce((s, a) => s + a.points, 0),
  };

  res.json({
    total_points: user.points,
    breakdown,
    activity: activity.map((a) => ({
      description: a.reason,
      points: a.points,
      timestamp: a.created_at,
    })),
  });
};

export const getLeaderboard = async (req: Request, res: Response): Promise<void> => {
  const { limit = '10', page = '1' } = req.query as Record<string, string | undefined>;
  const limitNum = Math.min(100, parseInt(limit ?? '10'));
  const pageNum = Math.max(1, parseInt(page ?? '1'));
  const skip = (pageNum - 1) * limitNum;

  const users = await prisma.user.findMany({
    orderBy: { points: 'desc' },
    skip,
    take: limitNum,
    select: {
      id: true,
      username: true,
      avatar_url: true,
      points: true,
      _count: { select: { votes: true } },
    },
  });

  const leaderboard = users.map((u, i) => ({
    rank: skip + i + 1,
    username: u.username,
    avatar_url: u.avatar_url,
    points: u.points,
    vote_count: u._count.votes,
  }));

  res.json({ leaderboard });
};
