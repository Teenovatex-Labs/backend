import { Router } from 'express';
import { z } from 'zod';
import { listRules, updateRule } from '../controllers/pointRules.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(requireAuth, requirePermission('points.manage'));

const amount = z.number().min(0).max(10000).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals');

router.get('/', listRules);
router.patch(
  '/:key',
  validate(z.union([
    z.object({ reset: z.literal(true) }).strict(),
    z.object({ points: amount.optional(), daily_cap: amount.nullable().optional() }).strict().refine((b) => b.points !== undefined || b.daily_cap !== undefined, 'Nothing to change'),
  ])),
  updateRule
);

export default router;
