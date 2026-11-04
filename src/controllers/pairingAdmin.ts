import type { Response } from 'express';
import { prisma } from '../db.js';
import { ageOn } from '../lib/age.js';
import { audit } from '../lib/audit.js';
import { dayToDb, localDay, shiftDay } from '../lib/day.js';
import { HttpError } from '../lib/errors.js';
import { createNotification } from '../lib/notify.js';
import { MAX_PAIRING_DAYS, OPEN_STATUSES, bandOf, checkPairing, scoreMatch, type Candidate } from '../lib/pairing.js';
import { activatePairing } from '../lib/pairingThread.js';
import { blockedEitherWay } from './safety.js';
import type { AuthRequest } from '../middleware/auth.js';

const people = { select: { id: true, username: true } } as const;

/** What an admin sees about a pairing. Names, emails and birth dates are never included; usernames only. */
const shape = (p: {
  id: string; kind: string; goal: string; rationale: string | null; status: string; supervised: boolean; supervisor_id: string | null;
  starts_on: Date | null; ends_on: Date; created_by: string; approved_by: string | null; second_approved_by: string | null; closed_reason: string | null;
  members: { user: { id: string; username: string } }[];
}) => ({
  id: p.id, kind: p.kind, goal: p.goal, rationale: p.rationale, status: p.status, supervised: p.supervised,
  supervisor_id: p.supervisor_id, starts_on: p.starts_on?.toISOString().slice(0, 10) ?? null, ends_on: p.ends_on.toISOString().slice(0, 10),
  created_by: p.created_by, approved_by: p.approved_by, second_approved_by: p.second_approved_by, closed_reason: p.closed_reason,
  members: p.members.map((m) => m.user),
});

const load = async (id: string) => {
  const p = await prisma.pairing.findUnique({ where: { id }, include: { members: { include: { user: people } } } });
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'Pairing not found');
  return p;
};

/**
 * Ranks who might suit a member. Active members only, the same age band, nobody already in a pairing and
 * nobody blocked either way. The system suggests; an admin always decides.
 */
export const suggestions = async (req: AuthRequest, res: Response): Promise<void> => {
  const memberId = String(req.query.member_id ?? '');
  const me = await prisma.user.findUnique({ where: { id: memberId }, select: { id: true, username: true, birth_date: true, interests: true, skills: true, membership_status: true } });
  if (!me) throw new HttpError(404, 'NOT_FOUND', 'Member not found');
  if (!me.birth_date) throw new HttpError(422, 'AGE_UNKNOWN', 'This member has no confirmed birth date.');
  const myBand = bandOf(ageOn(me.birth_date));
  const blocked = await blockedEitherWay(me.id);
  const busy = await prisma.pairingMember.findMany({ where: { pairing: { status: { in: [...OPEN_STATUSES] } } }, select: { user_id: true } });

  const pool = await prisma.user.findMany({
    where: { id: { notIn: [me.id, ...blocked, ...busy.map((b) => b.user_id)] }, membership_status: 'active', birth_date: { not: null } },
    select: { id: true, username: true, birth_date: true, interests: true, skills: true },
    take: 2000,
  });
  const mine: Candidate = { id: me.id, username: me.username, band: myBand, interests: me.interests, skills: me.skills };
  const items = pool
    .map((u) => ({ id: u.id, username: u.username, band: bandOf(ageOn(u.birth_date!)), interests: u.interests, skills: u.skills }))
    .filter((u) => u.band === myBand)
    .map((u) => ({ id: u.id, username: u.username, band: u.band, ...scoreMatch(mine, u) }))
    .filter((u) => u.score > 0)
    .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username))
    .slice(0, 10);
  res.json({ member: { id: me.id, username: me.username, band: myBand }, items });
};

export const createPairing = async (req: AuthRequest, res: Response): Promise<void> => {
  const b = req.body as { member_ids: string[]; goal: string; rationale?: string; ends_on: string; supervisor_id?: string };
  const today = localDay('UTC');
  if (b.ends_on <= today || b.ends_on > shiftDay(today, MAX_PAIRING_DAYS)) {
    throw new HttpError(400, 'VALIDATION_ERROR', `A pairing must end in the future and within ${MAX_PAIRING_DAYS} days.`);
  }
  const created = await prisma.$transaction(async (tx) => {
    const { crossBand } = await checkPairing(tx, { memberIds: b.member_ids, supervisorId: b.supervisor_id ?? null, rationale: b.rationale ?? null });
    const p = await tx.pairing.create({
      data: {
        kind: b.member_ids.length === 3 ? 'trio' : 'pair', goal: b.goal, rationale: b.rationale ?? null,
        supervised: crossBand, supervisor_id: crossBand ? b.supervisor_id : null,
        ends_on: dayToDb(b.ends_on), created_by: req.userId!, approved_by: crossBand ? null : req.userId,
        status: 'proposed', members: { create: b.member_ids.map((user_id) => ({ user_id })) },
      },
    });
    await audit(req.userId!, 'pairing.create', { type: 'pairing', id: p.id }, { supervised: crossBand, members: b.member_ids.length }, tx);
    // Same-band pairings need one admin's decision, which the creator has just made. Cross-band ones wait for a second admin.
    if (!crossBand) await activatePairing(tx, p.id);
    return p.id;
  });
  const p = await load(created);
  await notifyAfter(p, 'created');
  res.status(201).json(shape(p));
};

const notifyAfter = async (p: Awaited<ReturnType<typeof load>>, event: 'created' | 'approved' | 'closed') => {
  if (event === 'created' && p.status !== 'active') return;
  const msg = event === 'closed' ? 'Your pairing has ended.' : `You have been paired up to work on: ${p.goal}`;
  for (const m of p.members) await createNotification(m.user.id, 'pairing', msg, { link: '/pairing' });
  if (p.supervisor_id && event !== 'closed') await createNotification(p.supervisor_id, 'pairing', 'You have been named supervisor of a pairing.', { link: '/pairing' });
};

export const listPairings = async (req: AuthRequest, res: Response): Promise<void> => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const items = await prisma.pairing.findMany({
    where: status && ['proposed', 'active', 'closed', 'cancelled'].includes(status) ? { status: status as 'proposed' } : {},
    orderBy: { created_at: 'desc' }, take: 100, include: { members: { include: { user: people } } },
  });
  res.json({ items: items.map(shape) });
};

export const getPairing = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(shape(await load(String(req.params.id))));
};

/** The second admin's decision on a minor-and-adult pairing. The creator cannot be the second approver. */
export const approvePairing = async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await load(String(req.params.id));
  if (existing.status !== 'proposed') throw new HttpError(409, 'BAD_STATE', 'Only a proposed pairing can be approved.');
  if (existing.created_by === req.userId) throw new HttpError(403, 'SECOND_ADMIN_REQUIRED', 'A different admin has to approve this pairing.');
  if (existing.ends_on.toISOString().slice(0, 10) <= localDay('UTC')) throw new HttpError(409, 'EXPIRED', 'The end date has passed; create a new pairing.');

  await prisma.$transaction(async (tx) => {
    // Everything is checked again: a block or a withdrawn clearance since creation must stop this.
    await checkPairing(tx, { memberIds: existing.members.map((m) => m.user.id), supervisorId: existing.supervisor_id, rationale: existing.rationale, ignorePairingId: existing.id });
    const lock = await tx.pairing.updateMany({ where: { id: existing.id, status: 'proposed' }, data: { second_approved_by: req.userId } });
    if (lock.count === 0) throw new HttpError(409, 'BAD_STATE', 'Only a proposed pairing can be approved.');
    await audit(req.userId!, 'pairing.approve', { type: 'pairing', id: existing.id }, { supervised: existing.supervised }, tx);
    await activatePairing(tx, existing.id);
  });
  const p = await load(existing.id);
  await notifyAfter(p, 'approved');
  res.json(shape(p));
};

export const closePairing = async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await load(String(req.params.id));
  if (existing.status === 'closed' || existing.status === 'cancelled') throw new HttpError(409, 'BAD_STATE', 'This pairing is already finished.');
  const reason = (req.body as { reason: string }).reason;
  const wasProposed = existing.status === 'proposed';
  await prisma.pairing.update({ where: { id: existing.id }, data: { status: wasProposed ? 'cancelled' : 'closed', closed_reason: reason } });
  await audit(req.userId!, 'pairing.close', { type: 'pairing', id: existing.id }, { reason, was: existing.status });
  const p = await load(existing.id);
  if (!wasProposed) await notifyAfter(p, 'closed');
  res.json(shape(p));
};

/** An admin records that an adult has been vetted (or withdraws it). Only adults can be cleared. */
export const setClearance = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { cleared } = req.body as { cleared: boolean; note?: string };
  const u = await prisma.user.findUnique({ where: { id }, select: { birth_date: true } });
  if (!u) throw new HttpError(404, 'NOT_FOUND', 'Member not found');
  if (!u.birth_date || ageOn(u.birth_date) < 18) throw new HttpError(422, 'NOT_AN_ADULT', 'Only adults can be safeguarding-cleared.');
  if (id === req.userId) throw new HttpError(403, 'SELF_CLEARANCE', 'You cannot clear yourself.');
  await prisma.user.update({ where: { id }, data: { safeguarding_cleared_at: cleared ? new Date() : null, safeguarding_cleared_by: cleared ? req.userId : null } });
  await audit(req.userId!, cleared ? 'safeguarding.clear' : 'safeguarding.unclear', { type: 'user', id }, { note: (req.body as { note?: string }).note ?? null });
  res.json({ cleared });
};

/** A member's own pairings: partners' usernames, the goal and end date. The rationale and supervisor notes stay with staff. */
export const myPairings = async (req: AuthRequest, res: Response): Promise<void> => {
  const items = await prisma.pairing.findMany({
    where: { status: 'active', members: { some: { user_id: req.userId } } },
    include: { members: { include: { user: people } }, conversation: { select: { id: true } } },
  });
  res.json({
    items: items.map((p) => ({
      id: p.id, goal: p.goal, ends_on: p.ends_on.toISOString().slice(0, 10), supervised: p.supervised,
      partners: p.members.filter((m) => m.user.id !== req.userId).map((m) => ({ username: m.user.username })),
      conversation_id: p.conversation?.id ?? null,
    })),
  });
};
