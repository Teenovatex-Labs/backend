import { Router } from 'express';
import { claimQuest, claimWeekly, getQuest, getWeekly, myBadges } from '../controllers/rewards.js';
import { requireActiveMember, requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/badges', myBadges);
router.get('/quest', getQuest);
router.post('/quest/claim', requireActiveMember, claimQuest);
router.get('/weekly', getWeekly);
router.post('/weekly/:key/claim', requireActiveMember, claimWeekly);

export default router;
