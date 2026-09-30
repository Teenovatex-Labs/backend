import { Router } from 'express';
import { claimQuest, getQuest, myBadges } from '../controllers/rewards.js';
import { requireActiveMember, requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/badges', myBadges);
router.get('/quest', getQuest);
router.post('/quest/claim', requireActiveMember, claimQuest);

export default router;
