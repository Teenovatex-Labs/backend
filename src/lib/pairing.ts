import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { ageOn } from './age.js';
import { HttpError } from './errors.js';

export type Band = '13-15' | '16-17' | '18+';
export const bandOf = (age: number): Band => (age >= 18 ? '18+' : age >= 16 ? '16-17' : '13-15');
export const MAX_PAIRING_DAYS = 90;

type Db = Prisma.TransactionClient | typeof prisma;

/** Anyone still in a proposed or running pairing, so nobody is stretched across several at once. */
export const OPEN_STATUSES = ['proposed', 'active'] as const;

export type Checked = { ages: Map<string, number>; crossBand: boolean };

/**
 * Every rule that must hold when a pairing is created and again when it is approved, because things change
 * in between (someone is blocked, an adult's clearance is withdrawn). Throws a specific error for the first failure.
 */
export const checkPairing = async (
  db: Db,
  p: { memberIds: string[]; supervisorId: string | null; rationale: string | null; ignorePairingId?: string }
): Promise<Checked> => {
  const ids = p.memberIds;
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'VALIDATION_ERROR', 'Each member can appear only once.');

  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, birth_date: true, membership_status: true, safeguarding_cleared_at: true } });
  if (users.length !== ids.length) throw new HttpError(404, 'NOT_FOUND', 'One of the members does not exist.');
  if (users.some((u) => u.membership_status !== 'active')) throw new HttpError(409, 'MEMBER_NOT_ACTIVE', 'Only active members can be paired.');
  if (users.some((u) => !u.birth_date)) throw new HttpError(422, 'AGE_UNKNOWN', 'Every member needs a confirmed birth date before pairing.');

  const ages = new Map(users.map((u) => [u.id, ageOn(u.birth_date!)]));
  const minors = users.filter((u) => ages.get(u.id)! < 18);
  const adults = users.filter((u) => ages.get(u.id)! >= 18);
  const crossBand = minors.length > 0 && adults.length > 0;

  const busy = await db.pairingMember.findFirst({
    where: { user_id: { in: ids }, pairing: { status: { in: [...OPEN_STATUSES] }, ...(p.ignorePairingId && { id: { not: p.ignorePairingId } }) } },
  });
  if (busy) throw new HttpError(409, 'ALREADY_PAIRED', 'A member is already in an open pairing.');

  const blocks = await db.block.count({ where: { blocker_id: { in: ids }, blocked_id: { in: ids } } });
  if (blocks > 0) throw new HttpError(409, 'BLOCKED', 'Two of these members have blocked each other.');

  if (crossBand) {
    if (!p.supervisorId) throw new HttpError(422, 'SUPERVISOR_REQUIRED', 'A minor paired with an adult needs a designated supervisor.');
    if (!p.rationale || p.rationale.trim().length < 20) throw new HttpError(422, 'RATIONALE_REQUIRED', 'Explain in writing why this pairing is appropriate.');
    if (adults.some((a) => !a.safeguarding_cleared_at)) throw new HttpError(422, 'ADULT_NOT_CLEARED', 'The adult has not been safeguarding-cleared.');
    if (ids.includes(p.supervisorId)) throw new HttpError(422, 'SUPERVISOR_IS_MEMBER', 'The supervisor cannot be one of the paired members.');
    const sup = await db.user.findUnique({ where: { id: p.supervisorId }, select: { role: true, membership_status: true } });
    if (!sup || (sup.role !== 'admin' && sup.role !== 'moderator')) throw new HttpError(422, 'SUPERVISOR_INVALID', 'The supervisor must be a moderator or admin.');
  }
  return { ages, crossBand };
};

export type Candidate = { id: string; username: string; band: Band; interests: string[]; skills: string[] };

const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x));

/** Shared interests and skills count once, and a skill that matches the other person's interest counts double. */
export const scoreMatch = (me: Candidate, other: Candidate) => {
  const sharedInterests = overlap(me.interests, other.interests);
  const sharedSkills = overlap(me.skills, other.skills);
  const theyCanTeach = overlap(other.skills, me.interests);
  const iCanTeach = overlap(me.skills, other.interests);
  return {
    score: sharedInterests.length + sharedSkills.length + 2 * (theyCanTeach.length + iCanTeach.length),
    shared_interests: sharedInterests,
    shared_skills: sharedSkills,
    they_can_help_with: theyCanTeach,
    you_can_help_with: iCanTeach,
  };
};
