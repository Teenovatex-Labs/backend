import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { awardPoints } from '../lib/points.js';
import { createNotification } from '../lib/notify.js';

const MAX_DAILY_VOTES = 3;
const VOTE_POINTS = 10;

const todayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

export const castVote = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id: project_id } = req.params as { id: string };
  const userId = req.userId!;
  const { start, end } = todayRange();

  const project = await prisma.project.findUnique({ where: { id: project_id } });
  if (!project) { res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' }); return; }

  const alreadyVoted = await prisma.vote.findFirst({
    where: { user_id: userId, project_id, voted_at: { gte: start, lte: end } },
  });
  if (alreadyVoted) {
    res.status(400).json({ error: 'Already voted on this project today', code: 'ALREADY_VOTED' });
    return;
  }

  const votesToday = await prisma.vote.count({
    where: { user_id: userId, voted_at: { gte: start, lte: end } },
  });
  if (votesToday >= MAX_DAILY_VOTES) {
    res.status(429).json({ error: 'Daily vote limit reached. Resets at midnight.', code: 'VOTE_LIMIT' });
    return;
  }

  const [, updated] = await prisma.$transaction([
    prisma.vote.create({ data: { user_id: userId, project_id } }),
    prisma.project.update({ where: { id: project_id }, data: { vote_count: { increment: 1 } } }),
  ]);

  if (project.user_id !== userId) {
    await awardPoints(project.user_id, VOTE_POINTS, `Vote received on project "${project.name}"`, project_id);
    await createNotification(project.user_id, 'vote', `Someone voted on your project "${project.name}"`);
  }

  res.json({
    message: 'Vote cast successfully',
    new_vote_count: updated.vote_count,
    points_awarded: project.user_id !== userId ? VOTE_POINTS : 0,
    votes_remaining_today: MAX_DAILY_VOTES - votesToday - 1,
  });
};

export const removeVote = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id: project_id } = req.params as { id: string };
  const { start, end } = todayRange();

  const vote = await prisma.vote.findFirst({
    where: { user_id: req.userId, project_id, voted_at: { gte: start, lte: end } },
  });
  if (!vote) { res.status(404).json({ error: 'Vote not found', code: 'NOT_FOUND' }); return; }

  const [, updated] = await prisma.$transaction([
    prisma.vote.delete({ where: { id: vote.id } }),
    prisma.project.update({ where: { id: project_id }, data: { vote_count: { decrement: 1 } } }),
  ]);

  res.json({ message: 'Vote removed', new_vote_count: updated.vote_count });
};

export const getDailyVoteStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const { start, end } = todayRange();
  const resets_at = new Date(end);
  resets_at.setDate(resets_at.getDate() + 1);
  resets_at.setHours(0, 0, 0, 0);

  const votes_used_today = await prisma.vote.count({
    where: { user_id: req.userId, voted_at: { gte: start, lte: end } },
  });

  res.json({
    votes_used_today,
    votes_remaining: MAX_DAILY_VOTES - votes_used_today,
    resets_at: resets_at.toISOString(),
  });
};
