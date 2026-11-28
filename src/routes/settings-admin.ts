import { Router } from 'express';
import { getSettings, patchSetting } from '../controllers/settingsAdmin.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requirePermission('settings.manage'));

router.get('/', getSettings);
router.patch('/', patchSetting);

export default router;
