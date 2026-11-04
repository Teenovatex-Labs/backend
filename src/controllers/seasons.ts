import type { Response } from 'express';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import { fromScaled } from '../lib/pointsMath.js';
import { currentSeason } from '../lib/seasons.js';
import type { AuthRequest } from '../middleware/auth.js';

const shape = (s: { id: string; number: number; name: string; starts_at: Date; ends_at: Date | null; is_current: boolean }) => ({
  id: s.id, number: s.number, name: s.name, starts_at: s.starts_at.toISOString(), ends_at: s.ends_at?.toISOString() ?? null, is_current: s.is_current,
});

export const listSeasons = async (_req: AuthRequest, res: Response): Promise<void> => {
  const seasons = await prisma.season.findMany({ orderBy: { number: 'desc' }, include: { _count: { select: { totals: true } } } });
  res.json({ items: seasons.map((s) => ({ ...shape(s), archived_members: s._count.totals })) });
};

/** A member's archived totals, newest season first. Totals are in plain points. */
export const seasonTotals = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const top = await prisma.seasonTotal.findMany({ where: { season_id: id }, orderBy: { points: 'desc' }, take: 100, include: { user: { select: { username: true } } } });
  res.json({ items: top.map((t, i) => ({ rank: i + 1, username: t.user.username, points: fromScaled(t.points) })) });
};

/**
 * Ends the current season and starts the next. Everyone's total is archived first, then current-season
 * points go back to 0, all in one transaction so a failure leaves nothing half-done.
 */
export const startSeason = async (req: AuthRequest, res: Response): Promise<void> => {
  const { name } = req.body as { name?: string };
  const result = await prisma.$transaction(async (tx) => {
    const ending = await currentSeason(tx);
    const holders = await tx.user.findMany({ where: { points: { not: 0 } }, select: { id: true, points: true } });
    if (holders.length > 0) {
      await tx.seasonTotal.createMany({ data: holders.map((u) => ({ user_id: u.id, season_id: ending.id, points: u.points })), skipDuplicates: true });
    }
    await tx.season.update({ where: { id: ending.id }, data: { is_current: false, ends_at: new Date() } });
    await tx.user.updateMany({ data: { points: 0 } });
    const next = await tx.season.create({ data: { number: ending.number + 1, name: name?.trim() || `Season ${ending.number + 1}`, is_current: true, created_by: req.userId } });
    await audit(req.userId!, 'season.start', { type: 'season', id: next.id }, { ended: ending.number, archived: holders.length }, tx);
    return { ended: ending, next, archived: holders.length };
  });
  res.status(201).json({ ended: shape({ ...result.ended, is_current: false, ends_at: new Date() }), current: shape(result.next), archived_members: result.archived });
};

/** Members can browse past seasons; the same usernames, avatars and points the live leaderboard already shows. */
export const publicSeasons = async (_req: AuthRequest, res: Response): Promise<void> => {
  const seasons = await prisma.season.findMany({ orderBy: { number: 'desc' } });
  res.json({ items: seasons.map(shape) });
};

export const publicSeasonLeaderboard = async (req: AuthRequest, res: Response): Promise<void> => {
  const season = await prisma.season.findUnique({ where: { id: String(req.params.id) } });
  if (!season) throw new HttpError(404, 'NOT_FOUND', 'Season not found');
  if (season.is_current) throw new HttpError(409, 'SEASON_IN_PROGRESS', 'This season is still running; see the live leaderboard.');
  const top = await prisma.seasonTotal.findMany({
    where: { season_id: season.id }, orderBy: { points: 'desc' }, take: 50,
    include: { user: { select: { username: true, avatar_url: true } } },
  });
  res.json({ season: shape(season), leaderboard: top.map((t, i) => ({ rank: i + 1, username: t.user.username, avatar_url: t.user.avatar_url, points: fromScaled(t.points) })) });
};
