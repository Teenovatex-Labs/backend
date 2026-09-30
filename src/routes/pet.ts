import { Router } from 'express';
import { brain, listActions, logAction, petActionSchema, status, undoAction } from '../controllers/pet.js';
import { requireActiveMember, requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { petLimiter, writeLimiter } from '../middleware/rateLimiter.js';
import { z } from 'zod';

const router = Router();
router.use(requireAuth);

router.get('/status', status);
router.post(
  '/brain',
  requireActiveMember,
  petLimiter,
  validate(z.object({ text: z.string().trim().min(1).max(500), page: z.string().max(80).optional() })),
  brain
);

router.get('/actions', listActions);
router.post('/actions', requireActiveMember, writeLimiter, validate(petActionSchema), logAction);
router.post('/actions/:id/undo', requireActiveMember, writeLimiter, undoAction);

export default router;
