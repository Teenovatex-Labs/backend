import { Router } from 'express';
import { publicKey, subscribe, subscribeSchema, unsubscribe } from '../controllers/push.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(requireAuth);
router.get('/key', publicKey);
router.post('/subscribe', validate(subscribeSchema), subscribe);
router.post('/unsubscribe', unsubscribe);

export default router;
