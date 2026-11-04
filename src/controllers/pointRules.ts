import type { Response } from 'express';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { RULES, isRuleKey, resolveRule, type RuleKey } from '../lib/pointRules.js';
import { toScaled } from '../lib/pointsMath.js';
import type { AuthRequest } from '../middleware/auth.js';

export const listRules = async (_req: AuthRequest, res: Response): Promise<void> => {
  const items = await Promise.all((Object.keys(RULES) as RuleKey[]).map((k) => resolveRule(prisma, k)));
  res.json({ items });
};

/** points and daily_cap are plain points with at most two decimals; daily_cap null removes the cap. */
export const updateRule = async (req: AuthRequest, res: Response): Promise<void> => {
  const key = String(req.params.key);
  if (!isRuleKey(key)) { res.status(404).json({ error: 'No such point rule', code: 'NOT_FOUND' }); return; }
  const body = req.body as { points?: number; daily_cap?: number | null; reset?: true };
  const before = await resolveRule(prisma, key);

  if (body.reset) {
    await prisma.pointRule.deleteMany({ where: { key } });
  } else {
    const points = body.points ?? before.points;
    const cap = body.daily_cap === undefined ? before.daily_cap : body.daily_cap;
    if (cap !== null && cap < points) {
      res.status(400).json({ error: 'The daily cap cannot be lower than one award', code: 'VALIDATION_ERROR' });
      return;
    }
    const data = { points: toScaled(points), daily_cap: cap === null ? null : toScaled(cap), updated_by: req.userId };
    await prisma.pointRule.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
  const after = await resolveRule(prisma, key);
  await audit(req.userId!, 'point_rule.update', { type: 'point_rule', id: key }, { before: { points: before.points, daily_cap: before.daily_cap }, after: { points: after.points, daily_cap: after.daily_cap } });
  res.json(after);
};
