import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { dayToDb, localDay } from './day.js';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Makes a pairing live: marks it active and opens its in-platform thread for the members. A supervisor, when
 * there is one, is added from the first moment with read access only (enforced in the messages controller).
 */
export const activatePairing = async (tx: Db, pairingId: string): Promise<void> => {
  const p = await tx.pairing.findUniqueOrThrow({ where: { id: pairingId }, include: { members: true } });
  await tx.pairing.update({ where: { id: p.id }, data: { status: 'active', starts_on: dayToDb(localDay('UTC')), approved_by: p.approved_by ?? p.created_by } });
  const ids = [...p.members.map((m) => m.user_id), ...(p.supervisor_id ? [p.supervisor_id] : [])];
  await tx.conversation.create({ data: { pairing_id: p.id, members: { create: ids.map((user_id) => ({ user_id })) } } });
};

export type PairingState = { status: string; ends_on: Date; supervisor_id: string | null };

/** True while the thread accepts messages: the pairing is active and its last day has not passed. */
export const pairingIsLive = (p: PairingState): boolean => p.status === 'active' && p.ends_on.toISOString().slice(0, 10) >= localDay('UTC');
