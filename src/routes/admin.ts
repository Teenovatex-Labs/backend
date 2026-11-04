import { Router } from 'express';
import { listAttachments, reviewAttachment, listAudit, listReports, listUsers, resolveReport, setRole, stats, suspendUser, unsuspendUser } from '../controllers/admin.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as content from '../controllers/adminContent.js';
import { lessonSchema, reviewAttachmentSchema, lessonUpdateSchema, resolveReportSchema, roleSchema, suspendSchema, trackSchema, trackUpdateSchema } from '../schemas/safety.js';

const router = Router();
router.use(requireAuth, requirePermission('staff.access'));

router.get('/stats', requirePermission('analytics.read'), stats);
router.get('/reports', requirePermission('reports.read'), listReports);
router.post('/reports/:id/resolve', requirePermission('reports.resolve'), validate(resolveReportSchema), resolveReport);
router.get('/users', requirePermission('users.read'), listUsers);
router.post('/users/:id/suspend', requirePermission('users.suspend'), validate(suspendSchema), suspendUser);
router.post('/users/:id/unsuspend', requirePermission('users.suspend'), unsuspendUser);
router.post('/users/:id/role', requirePermission('users.set_role'), validate(roleSchema), setRole);
router.get('/audit', requirePermission('audit.read'), listAudit);
router.get('/attachments', requirePermission('attachments.review'), listAttachments);
router.post('/attachments/:id/review', requirePermission('attachments.review'), validate(reviewAttachmentSchema), reviewAttachment);
router.get('/analytics', requirePermission('analytics.read'), content.analytics);

router.get('/learn/tracks', requirePermission('learn.manage'), content.listTracks);
router.post('/learn/tracks', requirePermission('learn.manage'), validate(trackSchema), content.createTrack);
router.patch('/learn/tracks/:id', requirePermission('learn.manage'), validate(trackUpdateSchema), content.updateTrack);
router.delete('/learn/tracks/:id', requirePermission('learn.manage'), content.deleteTrack);
router.post('/learn/tracks/:id/lessons', requirePermission('learn.manage'), validate(lessonSchema), content.createLesson);
router.get('/learn/lessons/:id', requirePermission('learn.manage'), content.getLessonAdmin);
router.patch('/learn/lessons/:id', requirePermission('learn.manage'), validate(lessonUpdateSchema), content.updateLesson);
router.delete('/learn/lessons/:id', requirePermission('learn.manage'), content.deleteLesson);

export default router;
