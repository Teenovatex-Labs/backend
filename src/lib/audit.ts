import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

/** Records who did what to whom. There is no API to edit or delete these lines. */
export const audit = (
  actorId: string | null,
  action: string,
  target?: { type: string; id: string },
  meta?: Prisma.InputJsonValue,
  client: Prisma.TransactionClient | typeof prisma = prisma
) =>
  client.auditLog.create({
    data: { actor_id: actorId, action, target_type: target?.type ?? null, target_id: target?.id ?? null, ...(meta !== undefined && { meta }) },
  });
