import { Router } from 'express';
import { getLeaderboard } from '../controllers/points.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();

router.get('/', asyncHandler(getLeaderboard));

export default router;
