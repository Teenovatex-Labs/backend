import { Router } from 'express';
import {
  getMe,
  updateMe,
  uploadAvatar,
  getUserByUsername,
  getUserProjects,
  followUser,
  unfollowUser,
  setBirthDate,
  setUsername,
} from '../controllers/users.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { upload } from '../middleware/upload.js';
import { setBirthDateSchema, setUsernameSchema, updateUserSchema } from '../schemas/user.js';

const router = Router();

router.get('/me', requireAuth, getMe);
router.patch('/me', requireAuth, validate(updateUserSchema), updateMe);
router.post('/me/username', requireAuth, validate(setUsernameSchema), setUsername);
router.post('/me/birth-date', requireAuth, validate(setBirthDateSchema), setBirthDate);
router.post('/me/avatar', requireAuth, writeLimiter, upload.single('avatar'), uploadAvatar);
router.get('/:username', optionalAuth, getUserByUsername);
router.get('/:username/projects', optionalAuth, getUserProjects);
router.post('/:username/follow', requireAuth, followUser);
router.delete('/:username/follow', requireAuth, unfollowUser);

export default router;
