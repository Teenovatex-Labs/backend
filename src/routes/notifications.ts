import { Router } from 'express';
import { getNotifications, markAsRead, markAllAsRead } from '../controllers/notifications.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.get('/', getNotifications);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', markAsRead);

export default router;
