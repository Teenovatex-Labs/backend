import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';


export const listVotes = async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    page       = '1',
    limit      = '50',
    user_id,
    project_id,
    date, 
  } = req.query as Record<string, string | undefined>;

  const pageNum  = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip     = (pageNum - 1) * limitNum;

  
  let where: any = {};
  if (user_id) where.user_id = user_id;
  if (project_id) where.project_id = project_id;
  
  if (date) {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end   = new Date(`${date}T23:59:59.999Z`);
    if (!isNaN(start.getTime())) {
      where.voted_at = { gte: start, lte: end };
    }
  }

  const [votes, total] = await Promise.all([
    prisma.vote.findMany({
      where,
      orderBy: { voted_at: 'desc' },
      skip,
      take: limitNum,
      select: {
        id: true,
        voted_at: true,
        user: { select: { id: true, username: true } },
        project: {
          select: {
            id: true,
            name: true,
            user_id: true,
            user: { select: { username: true } },
          },
        },
      },
    }),
    prisma.vote.count({ where }),
  ]);

  
  const formattedVotes = votes.map((v) => ({
    id: v.id,
    voted_at: v.voted_at,
    voter: v.user,
    project: {
      id: v.project.id,
      name: v.project.name,
      owner: v.project.user.username,
      owner_id: v.project.user_id,
    },
  }));

  res.json({
    votes: formattedVotes,
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum),
  });
};


export const deleteVote = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };

  const vote = await prisma.vote.findUnique({
    where: { id },
    include: {
      user: { select: { username: true } },
      project: { select: { id: true, name: true, user_id: true } },
    },
  });

  if (!vote) {
    res.status(404).json({ error: 'Vote not found', code: 'NOT_FOUND' });
    return;
  }

  
  await prisma.$transaction([
    prisma.vote.delete({ where: { id } }),
    prisma.user.update({
      where: { id: vote.user_id },
      data: { points: { decrement: 10 } },
    }),
    prisma.project.update({
      where: { id: vote.project_id },
      data: { vote_count: { decrement: 1 } },
    }),
  ]);

  res.json({
    message: 'Vote removed',
    points_deducted: 10,
    voter: vote.user.username,
    project: vote.project.name,
  });
};
