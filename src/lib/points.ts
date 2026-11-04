import type { Prisma, PointsKind } from '@prisma/client';
import { prisma } from '../db.js';
import { toScaled } from './pointsMath.js';
import { currentSeason } from './seasons.js';

/**
 * Adds (or, when negative, takes back) points and writes the log row, inside an existing transaction.
 * `points` is in plain points (5, 0.3); it is stored in hundredths.
 */
export const awardPointsTx = async (
  tx: Prisma.TransactionClient,
  userId: string,
  kind: PointsKind,
  points: number,
  reason: string,
  reference_id?: string
) => {
  const scaled = toScaled(points);
  const season = await currentSeason(tx);
  await tx.user.update({ where: { id: userId }, data: { points: { increment: scaled } } });
  await tx.pointsLog.create({
    data: { user_id: userId, kind, points: scaled, reason, reference_id: reference_id ?? null, season_id: season.id },
  });
};

export const awardPoints = (userId: string, kind: PointsKind, points: number, reason: string, reference_id?: string) =>
  prisma.$transaction((tx) => awardPointsTx(tx, userId, kind, points, reason, reference_id));
