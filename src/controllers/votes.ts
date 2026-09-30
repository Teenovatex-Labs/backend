import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { awardPointsTx } from '../lib/points.js';
import { createNotification } from '../lib/notify.js';
import { dayToDb, localDay, nextLocalMidnight } from '../lib/day.js';

const MAX_DAILY_VOTES = 3;
const VOTE_POINTS = 10;

const timezoneOf = async (userId: string) =>
  (await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }))?.timezone ?? null;

type CastOutcome =
  | { kind: 'ok'; vote_count: number; used: number; awarded: number }
  | { kind: 'already' }
  | { kind: 'limit' };

export const castVote = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id: project_id } = req.params as { id: string };
  const userId = req.userId!;

  const project = await prisma.project.findUnique({ where: { id: project_id } });
  if (!project) { res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' }); return; }

  const timezone = await timezoneOf(userId);
  const vote_day = dayToDb(localDay(timezone));
  const isOwn = project.user_id === userId;

  let outcome: CastOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<CastOutcome> => {
      // Serialise this member's votes so two quick requests can't both pass the daily cap.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

      const used = await tx.vote.count({ where: { user_id: userId, vote_day } });
      if (used >= MAX_DAILY_VOTES) return { kind: 'limit' };

      await tx.vote.create({ data: { user_id: userId, project_id, vote_day } });
      const updated = await tx.project.update({
        where: { id: project_id },
        data: { vote_count: { increment: 1 } },
      });

      // Voting for your own lab is allowed but earns nothing, so it can't be farmed.
      let awarded = 0;
      if (!isOwn) {
        awarded = VOTE_POINTS;
        await awardPointsTx(tx, project.user_id, 'vote_received', VOTE_POINTS, `Vote received on lab "${project.name}"`, project_id);
      }
      return { kind: 'ok', vote_count: updated.vote_count, used: used + 1, awarded };
    });
  } catch (err) {
    // The unique key caught a second vote on the same project today.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      outcome = { kind: 'already' };
    } else {
      throw err;
    }
  }

  if (outcome.kind === 'already') {
    res.status(400).json({ error: 'Already voted on this project today', code: 'ALREADY_VOTED' });
    return;
  }
  if (outcome.kind === 'limit') {
    res.status(429).json({ error: 'Daily vote limit reached. Resets at midnight.', code: 'VOTE_LIMIT' });
    return;
  }

  if (!isOwn) {
    await createNotification(project.user_id, 'vote', `Someone voted on your lab "${project.name}"`, {
      link: `/labs/${project.slug}`,
      payload: { project_id, slug: project.slug },
    });
  }

  res.json({
    message: 'Vote cast successfully',
    new_vote_count: outcome.vote_count,
    points_awarded: outcome.awarded,
    votes_remaining_today: MAX_DAILY_VOTES - outcome.used,
  });
};

export const removeVote = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id: project_id } = req.params as { id: string };
  const userId = req.userId!;

  const vote_day = dayToDb(localDay(await timezoneOf(userId)));

  const result = await prisma.$transaction(async (tx) => {
    const vote = await tx.vote.findUnique({
      where: { user_id_project_id_vote_day: { user_id: userId, project_id, vote_day } },
      include: { project: { select: { user_id: true, name: true } } },
    });
    if (!vote) return null;

    await tx.vote.delete({ where: { id: vote.id } });
    const updated = await tx.project.update({
      where: { id: project_id },
      data: { vote_count: { decrement: 1 } },
    });
    // Take back exactly what this vote earned the lab's owner.
    if (vote.project.user_id !== userId) {
      await awardPointsTx(tx, vote.project.user_id, 'vote_removed', -VOTE_POINTS, `Vote removed on lab "${vote.project.name}"`, project_id);
    }
    return updated.vote_count;
  });

  if (result === null) { res.status(404).json({ error: 'Vote not found', code: 'NOT_FOUND' }); return; }
  res.json({ message: 'Vote removed', new_vote_count: result });
};

export const getDailyVoteStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const timezone = await timezoneOf(req.userId!);
  const vote_day = dayToDb(localDay(timezone));

  const votes_used_today = await prisma.vote.count({ where: { user_id: req.userId, vote_day } });

  res.json({
    votes_used_today,
    votes_remaining: MAX_DAILY_VOTES - votes_used_today,
    resets_at: nextLocalMidnight(timezone).toISOString(),
  });
};
