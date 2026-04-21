import express from 'express';
import { getProfile, updateProfile, deleteProfile } from '../controllers/userController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
const router = express.Router();
router.use(requireAuth);
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.delete('/profile', deleteProfile);
export default router;
//# sourceMappingURL=userRoutes.js.map