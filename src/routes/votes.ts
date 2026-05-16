import { Router } from 'express';
import { getDailyVoteStatus } from '../controllers/votes.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();

router.get('/my-daily-status', requireAuth, asyncHandler(getDailyVoteStatus));

export default router;
