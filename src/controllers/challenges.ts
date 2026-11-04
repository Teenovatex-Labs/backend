import type { Response } from 'express';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { assertClean } from '../lib/guard.js';
import { shapeChallenge } from './challengesAdmin.js';
import type { AuthRequest } from '../middleware/auth.js';

const visible = { status: { not: 'draft' as const } };
const isOpenNow = (c: { status: string; starts_at: Date; ends_at: Date }) => c.status === 'open' && c.starts_at <= new Date() && new Date() < c.ends_at;

const entryShape = (e: { id: string; title: string; body: string; links: unknown; status: string; submitted_at: Date }) => ({
  id: e.id, title: e.title, body: e.body, links: e.links, status: e.status, submitted_at: e.submitted_at.toISOString(),
});

export const listOpen = async (req: AuthRequest, res: Response): Promise<void> => {
  const items = await prisma.challenge.findMany({ where: visible, orderBy: { starts_at: 'desc' }, take: 50 });
  const mine = await prisma.challengeEntry.groupBy({ by: ['challenge_id'], where: { user_id: req.userId, status: 'submitted' }, _count: true });
  const counts = new Map(mine.map((m) => [m.challenge_id, m._count]));
  res.json({ items: items.map((c) => ({ ...shapeChallenge(c), my_entries: counts.get(c.id) ?? 0, accepting_entries: isOpenNow(c) })) });
};

/** Own entries always; the published podium (place, name, entry title) once results are out. Other entries stay private. */
export const getChallenge = async (req: AuthRequest, res: Response): Promise<void> => {
  const c = await prisma.challenge.findFirst({ where: { id: String(req.params.id), ...visible } });
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Challenge not found');
  const entries = await prisma.challengeEntry.findMany({ where: { challenge_id: c.id, user_id: req.userId }, orderBy: { submitted_at: 'asc' } });
  const podium = c.results_published_at
    ? await prisma.challengeResult.findMany({
        where: { challenge_id: c.id, place: { lte: 3 } },
        orderBy: [{ place: 'asc' }, { total: 'desc' }],
        include: { entry: { select: { title: true } } },
      })
    : [];
  const people = await prisma.user.findMany({ where: { id: { in: podium.map((p) => p.user_id) } }, select: { id: true, username: true, avatar_url: true } });
  const byId = new Map(people.map((p) => [p.id, p]));
  res.json({
    ...shapeChallenge(c),
    accepting_entries: isOpenNow(c),
    my_entries: entries.map(entryShape),
    my_results: c.results_published_at ? (await prisma.challengeResult.findMany({ where: { challenge_id: c.id, user_id: req.userId } })).map((r) => ({ entry_id: r.entry_id, place: r.place })) : [],
    podium: podium.map((p) => ({ place: p.place, username: byId.get(p.user_id)?.username ?? null, avatar_url: byId.get(p.user_id)?.avatar_url ?? null, entry_title: p.entry.title })),
  });
};

export const submitEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  const c = await prisma.challenge.findFirst({ where: { id: String(req.params.id), ...visible } });
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Challenge not found');
  if (!isOpenNow(c)) throw new HttpError(409, 'CHALLENGE_NOT_OPEN', 'This challenge is not taking entries right now.');
  const { title, body, links } = req.body as { title: string; body: string; links?: string[] };
  await assertClean(req.userId!, [title, body]);
  // Count and create in one transaction so two quick taps cannot slip past the limit.
  const entry = await prisma.$transaction(async (tx) => {
    const used = await tx.challengeEntry.count({ where: { challenge_id: c.id, user_id: req.userId, status: { not: 'withdrawn' } } });
    if (used >= c.entry_limit) throw new HttpError(409, 'ENTRY_LIMIT', `You can enter this challenge ${c.entry_limit === 1 ? 'once' : `${c.entry_limit} times`}.`);
    return tx.challengeEntry.create({ data: { challenge_id: c.id, user_id: req.userId!, title, body, links: links ?? [] } });
  });
  res.status(201).json(entryShape(entry));
};

const ownEntry = async (req: AuthRequest) => {
  const e = await prisma.challengeEntry.findFirst({ where: { id: String(req.params.entryId), user_id: req.userId }, include: { challenge: true } });
  if (!e) throw new HttpError(404, 'NOT_FOUND', 'Entry not found');
  return e;
};

export const editEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  const e = await ownEntry(req);
  if (e.status !== 'submitted') throw new HttpError(409, 'ENTRY_LOCKED', 'This entry can no longer be changed.');
  if (!isOpenNow(e.challenge)) throw new HttpError(409, 'CHALLENGE_NOT_OPEN', 'Entries can only be changed while the challenge is open.');
  const b = req.body as { title?: string; body?: string; links?: string[] };
  await assertClean(req.userId!, [b.title, b.body]);
  const updated = await prisma.challengeEntry.update({ where: { id: e.id }, data: b });
  res.json(entryShape(updated));
};

export const withdrawEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  const e = await ownEntry(req);
  if (e.challenge.status === 'closed') throw new HttpError(409, 'CHALLENGE_NOT_OPEN', 'Results are already published.');
  if (e.status === 'submitted') await prisma.challengeEntry.update({ where: { id: e.id }, data: { status: 'withdrawn' } });
  res.json({ ok: true });
};
