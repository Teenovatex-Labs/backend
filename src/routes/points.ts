import { Router } from 'express';
import { getMyPoints } from '../controllers/points.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/me', requireAuth, getMyPoints);

export default router;
