import type { Prisma, PointsKind } from '@prisma/client';
import { prisma } from '../db.js';

/** Adds (or, when negative, takes back) points and writes the log row, inside an existing transaction. */
export const awardPointsTx = async (
  tx: Prisma.TransactionClient,
  userId: string,
  kind: PointsKind,
  points: number,
  reason: string,
  reference_id?: string
) => {
  await tx.user.update({ where: { id: userId }, data: { points: { increment: points } } });
  await tx.pointsLog.create({
    data: { user_id: userId, kind, points, reason, reference_id: reference_id ?? null },
  });
};

export const awardPoints = (userId: string, kind: PointsKind, points: number, reason: string, reference_id?: string) =>
  prisma.$transaction((tx) => awardPointsTx(tx, userId, kind, points, reason, reference_id));
