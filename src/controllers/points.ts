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

  // Totals come from the whole history, grouped by the typed kind (not by guessing from the text).
  const grouped = await prisma.pointsLog.groupBy({ by: ['kind'], where: { user_id: req.userId }, _sum: { points: true } });
  const sum = (...kinds: string[]) => grouped.filter((g) => kinds.includes(g.kind)).reduce((n, g) => n + (g._sum.points ?? 0), 0);
  const breakdown = {
    votes_received: sum('vote_received', 'vote_removed'),
    posts_tagged: sum('post_tagged'),
    streak_bonus: sum('streak', 'streak_milestone'),
    lessons: sum('lesson'),
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
  const { limit = '10', page = '1', period = 'all' } = req.query as Record<string, string | undefined>;
  const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '10') || 10));
  const pageNum = Math.max(1, parseInt(page ?? '1') || 1);
  const skip = (pageNum - 1) * limitNum;

  if (period === 'week') {
    // A fresh race every week: points earned in the last 7 days, so a newcomer can catch up.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const grouped = await prisma.pointsLog.groupBy({
      by: ['user_id'],
      where: { created_at: { gte: since }, points: { gt: 0 } },
      _sum: { points: true },
      orderBy: { _sum: { points: 'desc' } },
      skip,
      take: limitNum,
    });
    const people = await prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.user_id) } },
      select: { id: true, username: true, avatar_url: true, _count: { select: { votes: true } } },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    res.json({
      period: 'week',
      leaderboard: grouped.flatMap((g, i) => {
        const p = byId.get(g.user_id);
        return p ? [{ rank: skip + i + 1, username: p.username, avatar_url: p.avatar_url, points: g._sum.points ?? 0, vote_count: p._count.votes }] : [];
      }),
    });
    return;
  }

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

  res.json({ period: 'all', leaderboard });
};
