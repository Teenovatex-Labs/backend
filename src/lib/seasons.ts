import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * The season points are currently counted in. There is always exactly one. If none exists (a fresh
 * database), Season 0 is created, so awarding points never fails for want of a season.
 */
export const currentSeason = async (db: Db = prisma) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const found = await db.season.findFirst({ where: { is_current: true } });
    if (found) return found;
    const last = await db.season.findFirst({ orderBy: { number: 'desc' }, select: { number: true } });
    try {
      return await db.season.create({ data: { number: (last?.number ?? -1) + 1, name: last ? `Season ${(last.number) + 1}` : 'Season 0', is_current: true } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
  }
  throw new Error('Could not establish a current season');
};
