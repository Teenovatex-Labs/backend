import { Router } from 'express';
import { getLeaderboard } from '../controllers/points.js';

const router = Router();

router.get('/', getLeaderboard);

export default router;
