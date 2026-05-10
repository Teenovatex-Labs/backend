import { prisma } from '../db.js';

export const awardPoints = async (
  userId: string,
  points: number,
  reason: string,
  reference_id?: string
) => {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { points: { increment: points } },
    }),
    prisma.pointsLog.create({
      data: { user_id: userId, points, reason, reference_id: reference_id ?? null },
    }),
  ]);
};
