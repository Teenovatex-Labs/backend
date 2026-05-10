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
import { updateUserSchema } from '../schemas/user.js';

const router = Router();

router.get('/me', requireAuth, getMe);
router.patch('/me', requireAuth, validate(updateUserSchema), updateMe);
router.post('/me/avatar', requireAuth, upload.single('avatar'), uploadAvatar);
router.get('/:username', getUserByUsername);
router.get('/:username/projects', getUserProjects);
router.post('/:username/follow', requireAuth, followUser);
router.delete('/:username/follow', requireAuth, unfollowUser);

export default router;
