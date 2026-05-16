import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';


export const getContestState = async (req: AuthRequest, res: Response): Promise<void> => {
  const [settings, totalVotes, activeProjects, activeVoters, topProjects] = await Promise.all([
    prisma.systemSetting.findMany({
      where: { key: { in: ['contest_status', 'contest_ends_at', 'contest_starts_at'] } },
    }),
    prisma.vote.count(),
    prisma.project.findMany({ select: { user_id: true }, distinct: ['user_id'] }),
    prisma.vote.findMany({ select: { user_id: true }, distinct: ['user_id'] }),
    prisma.project.findMany({
      orderBy: { vote_count: 'desc' },
      take: 10,
      select: { id: true, name: true, vote_count: true, user: { select: { username: true } } },
    }),
  ]);

  const dbSettings = Object.fromEntries(settings.map(s => [s.key, s.value]));
  
  const status   = dbSettings['contest_status']    ?? process.env.CONTEST_STATUS  ?? 'inactive';
  const endsAt   = dbSettings['contest_ends_at']   ?? process.env.CONTEST_ENDS_AT ?? '';
  const startsAt = dbSettings['contest_starts_at'] ?? '';

  const endsAtDate = endsAt ? new Date(endsAt) : null;
  const daysRemaining = endsAtDate
    ? Math.max(0, Math.ceil((endsAtDate.getTime() - Date.now()) / 86_400_000))
    : null;

  
  const participantIds = new Set([
    ...activeProjects.map(p => p.user_id),
    ...activeVoters.map(v => v.user_id),
  ]);

  res.json({
    status,
    starts_at: startsAt || null,
    ends_at: endsAt || null,
    days_remaining: daysRemaining,
    participants_count: participantIds.size,
    total_votes: totalVotes,
    top_projects: topProjects.map((p, i) => ({
      rank: i + 1,
      name: p.name,
      builder: p.user.username,
      vote_count: p.vote_count,
    })),
  });
};


export const updateContestStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const { status } = req.body as { status: string };

  await prisma.systemSetting.upsert({
    where: { key: 'contest_status' },
    update: { value: status },
    create: { key: 'contest_status', value: status },
  });

  res.json({ message: `Contest status updated to ${status}` });
};


type WinnerInput = { user_id: string; rank: number; prize: string };

export const announceWinners = async (req: AuthRequest, res: Response): Promise<void> => {
  const { winners, announcement_message } = req.body as { winners: WinnerInput[]; announcement_message: string };

  
  const userIds = winners.map(w => w.user_id);
  const usersCount = await prisma.user.count({ where: { id: { in: userIds } } });
  
  if (usersCount !== 3) {
    res.status(400).json({ error: 'One or more winner user_ids are invalid', code: 'INVALID_USER_ID' });
    return;
  }

  
  const allUsers = await prisma.user.findMany({ select: { id: true } });

  await prisma.$transaction([
    
    ...winners.map(w => 
      prisma.notification.create({
        data: {
          user_id: w.user_id,
          type: 'contest',
          message: `Congratulations! You placed rank ${w.rank} in the contest and won: ${w.prize}!`,
        },
      })
    ),
    
    prisma.notification.createMany({
      data: allUsers.map(u => ({
        user_id: u.id,
        type: 'announcement',
        message: announcement_message,
      })),
    }),
  ]);

  res.json({
    message: 'Winners announced and notified',
    broadcast_sent: true,
    winners_notified: 3,
  });
};
