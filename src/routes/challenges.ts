import { Router } from 'express';
import { z } from 'zod';
import { editEntry, getChallenge, listOpen, submitEntry, withdrawEntry } from '../controllers/challenges.js';
import {
  advanceChallenge, createChallenge, disqualifyEntry, judgeEntries, listChallenges, publishResults, scoreEntry, standings, updateChallenge,
} from '../controllers/challengesAdmin.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const criteria = z
  .array(z.object({ name: text(2, 40), weight: z.number().int().min(1).max(10) }))
  .min(1).max(8)
  .refine((c) => new Set(c.map((x) => x.name.toLowerCase())).size === c.length, 'Criterion names must be different');
const url = z.string().trim().url().max(300).refine((u) => /^https:\/\//.test(u), 'Links must start with https://');
const links = z.array(url).max(5);

const base = {
  title: text(3, 100), description: text(10, 1500), rules: text(10, 3000),
  kind: z.enum(['weekly', 'monthly', 'special']),
  starts_at: z.coerce.date(), ends_at: z.coerce.date(), judging_ends_at: z.coerce.date(),
  badge_id: z.string().uuid().nullable(), entry_limit: z.number().int().min(1).max(5),
};
const createSchema = z.object({ ...base, criteria, badge_id: base.badge_id.optional(), entry_limit: base.entry_limit.default(1) });
const updateSchema = z.object({ ...base, criteria }).partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const adminChallengesRouter = Router();
adminChallengesRouter.use(requireAuth);
adminChallengesRouter.get('/', requirePermission('challenges.manage'), listChallenges);
adminChallengesRouter.post('/', requirePermission('challenges.manage'), validate(createSchema), createChallenge);
adminChallengesRouter.patch('/:id', requirePermission('challenges.manage'), validate(updateSchema), updateChallenge);
adminChallengesRouter.post('/:id/status', requirePermission('challenges.manage'), validate(z.object({ to: z.enum(['open', 'judging']) })), advanceChallenge);
adminChallengesRouter.post('/:id/entries/:entryId/disqualify', requirePermission('challenges.manage'), validate(z.object({ reason: text(5, 300) })), disqualifyEntry);
adminChallengesRouter.get('/:id/entries', requirePermission('challenges.judge'), judgeEntries);
adminChallengesRouter.get('/:id/standings', requirePermission('challenges.judge'), standings);
adminChallengesRouter.put(
  '/:id/entries/:entryId/score',
  requirePermission('challenges.judge'),
  validate(z.object({ scores: z.record(z.string(), z.number().int().min(0).max(10)), note: text(1, 500).optional() })),
  scoreEntry
);
adminChallengesRouter.post('/:id/publish-results', requirePermission('challenges.judge'), publishResults);

export const challengesRouter = Router();
challengesRouter.use(requireAuth);
challengesRouter.get('/', listOpen);
challengesRouter.get('/:id', getChallenge);
challengesRouter.post('/:id/entries', validate(z.object({ title: text(3, 100), body: text(10, 4000), links: links.optional() })), submitEntry);
challengesRouter.patch('/entries/:entryId', validate(z.object({ title: text(3, 100).optional(), body: text(10, 4000).optional(), links: links.optional() }).refine((v) => Object.keys(v).length > 0, 'Nothing to update')), editEntry);
challengesRouter.delete('/entries/:entryId', withdrawEntry);
