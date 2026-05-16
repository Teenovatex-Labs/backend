import { Router } from 'express';
import { getMyPoints } from '../controllers/points.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();

router.get('/me', requireAuth, asyncHandler(getMyPoints));

export default router;
