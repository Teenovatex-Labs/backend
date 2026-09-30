import { Router } from 'express';
import { getNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification } from '../controllers/notifications.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);

export default router;
