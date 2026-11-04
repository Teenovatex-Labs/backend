import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import { createNotification } from '../lib/notify.js';
import { PRIZE_RULES, rank, weightedTotal, type Criterion } from '../lib/challenges.js';
import { awardRuleTx } from '../lib/pointRules.js';
import type { AuthRequest } from '../middleware/auth.js';

type ChallengeRow = Prisma.ChallengeGetPayload<object>;

export const shapeChallenge = (c: ChallengeRow) => ({
  id: c.id, title: c.title, description: c.description, rules: c.rules, kind: c.kind, status: c.status,
  starts_at: c.starts_at.toISOString(), ends_at: c.ends_at.toISOString(), judging_ends_at: c.judging_ends_at.toISOString(),
  criteria: c.criteria as Criterion[], badge_id: c.badge_id, entry_limit: c.entry_limit,
  results_published: c.results_published_at !== null,
});

const getChallenge = async (id: string) => {
  const c = await prisma.challenge.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Challenge not found');
  return c;
};

const checkDates = (d: { starts_at: Date; ends_at: Date; judging_ends_at: Date }) => {
  if (!(d.starts_at < d.ends_at)) throw new HttpError(400, 'VALIDATION_ERROR', 'The challenge must end after it starts');
  if (!(d.ends_at <= d.judging_ends_at)) throw new HttpError(400, 'VALIDATION_ERROR', 'Judging cannot finish before entries close');
};

const checkBadge = async (badge_id: string | null | undefined) => {
  if (!badge_id) return;
  const b = await prisma.badgeDefinition.findUnique({ where: { id: badge_id } });
  if (!b || !b.active) throw new HttpError(400, 'VALIDATION_ERROR', 'That badge does not exist or is switched off');
};

export const listChallenges = async (_req: AuthRequest, res: Response): Promise<void> => {
  const items = await prisma.challenge.findMany({ orderBy: { starts_at: 'desc' }, include: { _count: { select: { entries: true } } } });
  res.json({ items: items.map((c) => ({ ...shapeChallenge(c), entries: c._count.entries })) });
};

export const createChallenge = async (req: AuthRequest, res: Response): Promise<void> => {
  const b = req.body as Omit<ChallengeRow, 'id' | 'status' | 'results_published_at' | 'created_by' | 'created_at' | 'updated_at' | 'criteria'> & { criteria: Criterion[] };
  checkDates(b);
  await checkBadge(b.badge_id);
  const c = await prisma.challenge.create({ data: { ...b, criteria: b.criteria, created_by: req.userId } });
  await audit(req.userId!, 'challenge.create', { type: 'challenge', id: c.id });
  res.status(201).json(shapeChallenge(c));
};

/** Drafts can change freely; once open, only wording and dates, so entries are judged by the rules people entered under. */
export const updateChallenge = async (req: AuthRequest, res: Response): Promise<void> => {
  const c = await getChallenge(String(req.params.id));
  const b = req.body as Partial<ChallengeRow> & { criteria?: Criterion[] };
  if (c.status !== 'draft' && (b.criteria || b.entry_limit !== undefined || b.rules !== undefined)) {
    throw new HttpError(409, 'CHALLENGE_LOCKED', 'Criteria, rules and entry limit cannot change once a challenge is open.');
  }
  if (c.status === 'closed') throw new HttpError(409, 'CHALLENGE_LOCKED', 'This challenge is finished.');
  checkDates({ starts_at: b.starts_at ?? c.starts_at, ends_at: b.ends_at ?? c.ends_at, judging_ends_at: b.judging_ends_at ?? c.judging_ends_at });
  if (b.badge_id !== undefined) await checkBadge(b.badge_id);
  const updated = await prisma.challenge.update({ where: { id: c.id }, data: { ...b, criteria: b.criteria } });
  await audit(req.userId!, 'challenge.update', { type: 'challenge', id: c.id }, { fields: Object.keys(b) });
  res.json(shapeChallenge(updated));
};

const NEXT: Record<string, string> = { draft: 'open', open: 'judging' };

/** draft -> open -> judging. Closing happens only by publishing results. */
export const advanceChallenge = async (req: AuthRequest, res: Response): Promise<void> => {
  const c = await getChallenge(String(req.params.id));
  const to = (req.body as { to: string }).to;
  if (NEXT[c.status] !== to) throw new HttpError(409, 'BAD_TRANSITION', `A ${c.status} challenge cannot move to ${to}.`);
  const updated = await prisma.challenge.update({ where: { id: c.id }, data: { status: to as 'open' | 'judging' } });
  await audit(req.userId!, 'challenge.status', { type: 'challenge', id: c.id }, { from: c.status, to });
  res.json(shapeChallenge(updated));
};

export const disqualifyEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  const entry = await prisma.challengeEntry.findFirst({ where: { id: String(req.params.entryId), challenge_id: String(req.params.id) } });
  if (!entry) throw new HttpError(404, 'NOT_FOUND', 'Entry not found');
  const c = await getChallenge(entry.challenge_id);
  if (c.status === 'closed') throw new HttpError(409, 'CHALLENGE_LOCKED', 'Results are already published.');
  await prisma.challengeEntry.update({ where: { id: entry.id }, data: { status: 'disqualified', dq_reason: (req.body as { reason: string }).reason } });
  await audit(req.userId!, 'challenge.disqualify', { type: 'challenge_entry', id: entry.id }, { reason: (req.body as { reason: string }).reason });
  res.json({ ok: true });
};

/** Judges see entries only once judging starts, with their own scores. Entrant names stay visible to staff only. */
export const judgeEntries = async (req: AuthRequest, res: Response): Promise<void> => {
  const c = await getChallenge(String(req.params.id));
  if (c.status !== 'judging' && c.status !== 'closed') throw new HttpError(409, 'NOT_JUDGING', 'Entries open for judging once the challenge moves to judging.');
  const entries = await prisma.challengeEntry.findMany({
    where: { challenge_id: c.id, status: 'submitted' },
    orderBy: { submitted_at: 'asc' },
    include: { scores: { where: { judge_id: req.userId } } },
  });
  res.json({
    criteria: c.criteria,
    items: entries.map((e) => ({
      id: e.id, title: e.title, body: e.body, links: e.links, own_entry: e.user_id === req.userId,
      my_score: e.scores[0] ? { scores: e.scores[0].scores, total: e.scores[0].total / 100, note: e.scores[0].note } : null,
    })),
  });
};

export const scoreEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  const c = await getChallenge(String(req.params.id));
  if (c.status !== 'judging') throw new HttpError(409, 'NOT_JUDGING', 'Scores can only be given while the challenge is in judging.');
  const entry = await prisma.challengeEntry.findFirst({ where: { id: String(req.params.entryId), challenge_id: c.id } });
  if (!entry || entry.status !== 'submitted') throw new HttpError(404, 'NOT_FOUND', 'Entry not found');
  if (entry.user_id === req.userId) throw new HttpError(403, 'CONFLICT_OF_INTEREST', 'You cannot score your own entry.');
  const criteria = c.criteria as Criterion[];
  const { scores, note } = req.body as { scores: Record<string, number>; note?: string };
  const names = new Set(criteria.map((x) => x.name));
  if (Object.keys(scores).length !== names.size || Object.keys(scores).some((k) => !names.has(k))) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Score every criterion exactly once.');
  }
  const total = weightedTotal(criteria, scores);
  await prisma.challengeScore.upsert({
    where: { entry_id_judge_id: { entry_id: entry.id, judge_id: req.userId! } },
    create: { entry_id: entry.id, judge_id: req.userId!, scores, total, note: note ?? null },
    update: { scores, total, note: note ?? null },
  });
  res.json({ total: total / 100 });
};

const tally = async (db: Prisma.TransactionClient | typeof prisma, challengeId: string) => {
  const entries = await db.challengeEntry.findMany({ where: { challenge_id: challengeId, status: 'submitted' }, include: { scores: true } });
  const unscored = entries.filter((e) => e.scores.length === 0).length;
  const scored = entries.filter((e) => e.scores.length > 0).map((e) => ({
    entryId: e.id, userId: e.user_id, title: e.title, judges: e.scores.length,
    total: Math.round(e.scores.reduce((n, s) => n + s.total, 0) / e.scores.length),
  }));
  return { unscored, ranked: rank(scored).map((r) => ({ ...r, title: scored.find((s) => s.entryId === r.entryId)!.title, judges: scored.find((s) => s.entryId === r.entryId)!.judges })) };
};

export const standings = async (req: AuthRequest, res: Response): Promise<void> => {
  const c = await getChallenge(String(req.params.id));
  const t = await tally(prisma, c.id);
  res.json({ unscored_entries: t.unscored, items: t.ranked.map((r) => ({ entry_id: r.entryId, title: r.title, place: r.place, average: r.total / 100, judges: r.judges })) });
};

/**
 * Closes the challenge: stores places, gives the linked badge to first place and prize points to the top three
 * (ties share a place and its prize), then notifies everyone who entered. Safe to call twice.
 */
export const publishResults = async (req: AuthRequest, res: Response): Promise<void> => {
  const c = await getChallenge(String(req.params.id));
  if (c.results_published_at) { res.json({ already_published: true, ...shapeChallenge(c) }); return; }
  if (c.status !== 'judging') throw new HttpError(409, 'NOT_JUDGING', 'Move the challenge to judging first.');

  const outcome = await prisma.$transaction(async (tx) => {
    // The conditional update is the idempotency lock: only one concurrent publisher gets a count of 1.
    const lock = await tx.challenge.updateMany({ where: { id: c.id, results_published_at: null }, data: { results_published_at: new Date(), status: 'closed' } });
    if (lock.count === 0) return null;
    const t = await tally(tx, c.id);
    if (t.ranked.length === 0) throw new HttpError(409, 'NO_ENTRIES', 'There are no scored entries to publish.');
    if (t.unscored > 0) throw new HttpError(409, 'UNSCORED_ENTRIES', `${t.unscored} entries have no score yet.`);
    const winners = t.ranked.filter((r) => r.place <= 3);
    if (winners.some((w) => w.userId === req.userId)) {
      throw new HttpError(403, 'CONFLICT_OF_INTEREST', 'You placed in this challenge, so someone else needs to publish the results.');
    }
    await tx.challengeResult.createMany({ data: t.ranked.map((r) => ({ challenge_id: c.id, entry_id: r.entryId, user_id: r.userId, place: r.place, total: r.total })) });
    const badge = c.badge_id ? await tx.badgeDefinition.findUnique({ where: { id: c.badge_id } }) : null;
    for (const w of winners) {
      await awardRuleTx(tx, w.userId, PRIZE_RULES[w.place as 1 | 2 | 3], `Placed ${w.place} in "${c.title}"`, c.id);
      if (badge && badge.active && w.place === 1) {
        const has = await tx.badgeAward.findFirst({ where: { user_id: w.userId, badge_id: badge.id, revoked_at: null } });
        if (!has || badge.repeatable) {
          await tx.badgeAward.create({ data: { user_id: w.userId, badge_id: badge.id, awarded_by: req.userId!, reason: `Won "${c.title}"`, challenge_id: c.id } });
        }
      }
    }
    await audit(req.userId!, 'challenge.publish', { type: 'challenge', id: c.id }, { entries: t.ranked.length, winners: winners.length }, tx);
    return t.ranked;
  });

  if (!outcome) { res.json({ already_published: true }); return; }
  for (const r of outcome) {
    const msg = r.place <= 3 ? `You placed ${r.place === 1 ? '1st' : r.place === 2 ? '2nd' : '3rd'} in ${c.title}!` : `Results are in for ${c.title}. Thanks for entering!`;
    await createNotification(r.userId, 'challenge', msg, { link: `/challenges/${c.id}` });
  }
  res.status(201).json({ published: true, results: outcome.length });
};
