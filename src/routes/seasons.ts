import { Router } from 'express';
import { z } from 'zod';
import { listSeasons, seasonTotals, startSeason } from '../controllers/seasons.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(requireAuth, requirePermission('points.manage'));

router.get('/', listSeasons);
router.get('/:id/totals', seasonTotals);
// Resets everyone's current points, so it has to be asked for deliberately.
router.post('/start', validate(z.object({ confirm: z.literal(true), name: z.string().trim().min(2).max(60).optional() })), startSeason);

export default router;
