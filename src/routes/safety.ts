import { Router } from 'express';
import { blockUser, createReport, listBlocks, unblockUser } from '../controllers/safety.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { reportSchema } from '../schemas/safety.js';

export const reportsRouter = Router();
reportsRouter.post('/', requireAuth, writeLimiter, validate(reportSchema), createReport);

export const blocksRouter = Router();
blocksRouter.use(requireAuth);
blocksRouter.get('/', listBlocks);
blocksRouter.post('/:username', writeLimiter, blockUser);
blocksRouter.delete('/:username', unblockUser);
