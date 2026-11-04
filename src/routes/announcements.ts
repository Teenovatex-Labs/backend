import { Router } from 'express';
import { create, listActive, listAll, remove } from '../controllers/announcements.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createAnnouncementSchema } from '../schemas/announcements.js';

const router = Router();
const staff = [requireAuth, requirePermission('announcements.manage')];

router.get('/', requireAuth, listActive);
router.get('/all', ...staff, listAll);
router.post('/', ...staff, validate(createAnnouncementSchema), create);
router.delete('/:id', ...staff, remove);

export default router;
