import { Router } from 'express';
import { getDailyVoteStatus } from '../controllers/votes.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/my-daily-status', requireAuth, getDailyVoteStatus);

export default router;
