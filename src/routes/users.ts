import { Router } from 'express';
import {
  getMe,
  updateMe,
  uploadAvatar,
  getUserByUsername,
  getUserProjects,
  followUser,
  unfollowUser,
} from '../controllers/users.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload } from '../middleware/upload.js';
import { asyncHandler } from '../middleware/error.js';
import { updateUserSchema } from '../schemas/user.js';

const router = Router();

router.get('/me', requireAuth, asyncHandler(getMe));
router.patch('/me', requireAuth, validate(updateUserSchema), asyncHandler(updateMe));
router.post('/me/avatar', requireAuth, upload.single('avatar'), asyncHandler(uploadAvatar));
router.get('/:username', asyncHandler(getUserByUsername));
router.get('/:username/projects', asyncHandler(getUserProjects));
router.post('/:username/follow', requireAuth, asyncHandler(followUser));
router.delete('/:username/follow', requireAuth, asyncHandler(unfollowUser));

export default router;
