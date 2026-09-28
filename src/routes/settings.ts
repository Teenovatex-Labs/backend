import { Router } from 'express';
import {
  changePassword,
  getSessions,
  revokeSession,
  updateNotifications,
  deleteAccount,
} from '../controllers/settings.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { changePasswordSchema, updateNotificationsSchema, deleteAccountSchema } from '../schemas/settings.js';

const router = Router();

router.use(requireAuth);
router.patch('/password', authLimiter, validate(changePasswordSchema), changePassword);
router.get('/sessions', getSessions);
router.delete('/sessions/:id', revokeSession);
router.patch('/notifications', validate(updateNotificationsSchema), updateNotifications);
router.delete('/account', authLimiter, validate(deleteAccountSchema), deleteAccount);

export default router;
