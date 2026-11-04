import type { Prisma, PointsKind } from '@prisma/client';
import { awardPointsTx } from './points.js';
import { fromScaled, toScaled } from './pointsMath.js';

/**
 * What each action is worth by default, in plain points. An admin can override the value and add a
 * per-member daily cap through /admin/point-rules; overrides live in the point_rules table.
 */
export const RULES = {
  vote_received: { points: 10, daily_cap: null, description: 'A member votes for your lab' },
  post_tagged: { points: 5, daily_cap: null, description: 'Posting an update that tags TX' },
  lesson: { points: 5, daily_cap: null, description: 'Finishing a lesson' },
  streak: { points: 3, daily_cap: null, description: 'Daily login streak' },
  streak_milestone: { points: 25, daily_cap: null, description: 'Hitting a streak milestone' },
  // Placeholder prize values until the approved points table is in; all three are logged as kind 'challenge'.
  challenge_place_1: { points: 50, daily_cap: null, description: 'First place in a judged challenge' },
  challenge_place_2: { points: 30, daily_cap: null, description: 'Second place in a judged challenge' },
  challenge_place_3: { points: 20, daily_cap: null, description: 'Third place in a judged challenge' },
} as const;

export type RuleKey = keyof typeof RULES;
/** The points_log kind a rule is recorded under (most rules have a kind of the same name). */
export const kindOf = (key: RuleKey): PointsKind => (key.startsWith('challenge_') ? 'challenge' : (key as PointsKind));
export const isRuleKey = (k: string): k is RuleKey => Object.prototype.hasOwnProperty.call(RULES, k);

/** Unknown keys throw, so a typo in a call site fails in tests instead of silently awarding nothing. */
export const resolveRule = async (db: Prisma.TransactionClient, key: RuleKey) => {
  if (!isRuleKey(key)) throw new Error(`Unknown point rule: ${key}`);
  const row = await db.pointRule.findUnique({ where: { key } });
  const base = RULES[key];
  return {
    key,
    points: row ? fromScaled(row.points) : base.points,
    daily_cap: row ? (row.daily_cap === null ? null : fromScaled(row.daily_cap)) : base.daily_cap,
    description: base.description,
    customised: !!row,
  };
};

const startOfUtcDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Awards the rule's points to a member, respecting the daily cap (the award is trimmed to what is left,
 * or skipped). Returns the plain points actually awarded.
 */
export const awardRuleTx = async (
  tx: Prisma.TransactionClient,
  userId: string,
  key: RuleKey,
  reason: string,
  reference_id?: string
): Promise<number> => {
  const rule = await resolveRule(tx, key);
  let amount = toScaled(rule.points);
  if (amount <= 0) return 0;
  if (rule.daily_cap !== null) {
    const earned = await tx.pointsLog.aggregate({
      where: { user_id: userId, kind: kindOf(key), points: { gt: 0 }, created_at: { gte: startOfUtcDay() } },
      _sum: { points: true },
    });
    amount = Math.min(amount, Math.max(0, toScaled(rule.daily_cap) - (earned._sum.points ?? 0)));
    if (amount === 0) return 0;
  }
  await awardPointsTx(tx, userId, kindOf(key), fromScaled(amount), reason, reference_id);
  return fromScaled(amount);
};
