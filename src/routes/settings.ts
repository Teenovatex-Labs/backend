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
import { asyncHandler } from '../middleware/error.js';
import { changePasswordSchema, updateNotificationsSchema, deleteAccountSchema } from '../schemas/settings.js';

const router = Router();

router.use(requireAuth);
router.patch('/password', validate(changePasswordSchema), asyncHandler(changePassword));
router.get('/sessions', asyncHandler(getSessions));
router.delete('/sessions/:id', asyncHandler(revokeSession));
router.patch('/notifications', validate(updateNotificationsSchema), asyncHandler(updateNotifications));
router.delete('/account', validate(deleteAccountSchema), asyncHandler(deleteAccount));

export default router;
