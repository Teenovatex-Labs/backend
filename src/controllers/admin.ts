import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';


export const getAdminStats = async (_req: AuthRequest, res: Response): Promise<void> => {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  
  const [
    usersTotal,
    usersNewToday,
    usersActiveToday,
    usersBanned,
    projectsTotal,
    projectsNewToday,
    projectsFeatured,
    projectsFlagged,
    votesTotal,
    votesToday,
    pointsAggregateOrPointsLogAgg,
    pointsAggregateOrSettings,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { created_at:    { gte: startOfToday } } }),
    prisma.user.count({ where: { last_login_at: { gte: startOfToday } } }),
    prisma.user.count({ where: { banned: true } }),

    prisma.project.count(),
    prisma.project.count({ where: { created_at: { gte: startOfToday } } }),
    prisma.project.count({ where: { featured:   true } }),
    prisma.project.count({ where: { flagged:    true } }),

    prisma.vote.count(),
    prisma.vote.count({ where: { voted_at: { gte: startOfToday } } }),

    prisma.pointsLog.aggregate({ _sum: { points: true } }),

    prisma.systemSetting.findMany({
      where: { key: { in: ['contest_status', 'contest_ends_at'] } }
    }),
  ]);

  
  const dbSettings = Object.fromEntries(pointsAggregateOrSettings.map(s => [s.key, s.value]));
  const contestEndsAtRaw = dbSettings['contest_ends_at'] ?? process.env.CONTEST_ENDS_AT ?? '';
  const contestStatus    = dbSettings['contest_status'] ?? process.env.CONTEST_STATUS  ?? 'inactive';
  const endsAt           = contestEndsAtRaw ? new Date(contestEndsAtRaw) : null;

  const daysRemaining = endsAt
    ? Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 86_400_000))
    : null;

  
  res.json({
    users: {
      total:        usersTotal,
      new_today:    usersNewToday,
      active_today: usersActiveToday,
      banned:       usersBanned,
    },
    projects: {
      total:     projectsTotal,
      new_today: projectsNewToday,
      featured:  projectsFeatured,
      flagged:   projectsFlagged,
    },
    votes: {
      total:      votesTotal,
      cast_today: votesToday,
    },
    points: {
      total_awarded: pointsAggregateOrPointsLogAgg._sum.points ?? 0,
    },
    contest: {
      status:         contestStatus,
      days_remaining: daysRemaining,
      ends_at:        endsAt?.toISOString() ?? null,
    },
  });
};
