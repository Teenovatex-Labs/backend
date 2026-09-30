import { Router } from 'express';
import { addMemory, brain, forgetMemory, listActions, listMemories, logAction, petActionSchema, status, undoAction } from '../controllers/pet.js';
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
  validate(z.object({
    text: z.string().trim().min(1).max(500),
    page: z.string().max(80).optional(),
    // The last few turns, so he keeps the thread. Each is capped, and only the member's own chat is ever sent.
    history: z.array(z.object({ from: z.enum(['you', 'alfred']), text: z.string().trim().min(1).max(300) })).max(6).optional(),
  })),
  brain
);

router.get('/memory', listMemories);
router.post('/memory', requireActiveMember, writeLimiter, validate(z.object({ text: z.string().trim().min(3).max(120) })), addMemory);
router.delete('/memory/:id', forgetMemory);
router.delete('/memory', forgetMemory);
router.get('/actions', listActions);
router.post('/actions', requireActiveMember, writeLimiter, validate(petActionSchema), logAction);
router.post('/actions/:id/undo', requireActiveMember, writeLimiter, undoAction);

export default router;
