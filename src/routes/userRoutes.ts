import express from 'express';
import { getProfile, updateProfile, deleteProfile } from '../controllers/userController';
import { requireAuth } from '../middleware/authMiddleware';

const router = express.Router();

router.use(requireAuth);

router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.delete('/profile', deleteProfile);

export const userRoutes = router;
