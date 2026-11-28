import { Router } from 'express';
import { hideContent, listComments, listLabs, listPosts, moderationStats, restoreContent } from '../controllers/moderation.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/stats', requirePermission('moderation.read'), moderationStats);
router.get('/posts', requirePermission('moderation.read'), listPosts);
router.get('/comments', requirePermission('moderation.read'), listComments);
router.get('/labs', requirePermission('moderation.read'), listLabs);
router.post('/:type/:id/hide', requirePermission('moderation.read', 'reports.resolve'), hideContent);
router.post('/:type/:id/restore', requirePermission('moderation.read', 'reports.resolve'), restoreContent);

export default router;
