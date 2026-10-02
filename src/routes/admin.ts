import { Router } from 'express';
import { listAttachments, reviewAttachment, listAudit, listReports, listUsers, resolveReport, setRole, stats, suspendUser, unsuspendUser } from '../controllers/admin.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as content from '../controllers/adminContent.js';
import { lessonSchema, reviewAttachmentSchema, lessonUpdateSchema, resolveReportSchema, roleSchema, suspendSchema, trackSchema, trackUpdateSchema } from '../schemas/safety.js';

const router = Router();
router.use(requireAuth, requireRole('moderator', 'admin'));

router.get('/stats', stats);
router.get('/reports', listReports);
router.post('/reports/:id/resolve', validate(resolveReportSchema), resolveReport);
router.get('/users', listUsers);
router.post('/users/:id/suspend', validate(suspendSchema), suspendUser);
router.post('/users/:id/unsuspend', unsuspendUser);
router.post('/users/:id/role', requireRole('admin'), validate(roleSchema), setRole);
router.get('/audit', listAudit);
router.get('/attachments', listAttachments);
router.post('/attachments/:id/review', validate(reviewAttachmentSchema), reviewAttachment);
router.get('/analytics', content.analytics);

router.get('/learn/tracks', content.listTracks);
router.post('/learn/tracks', validate(trackSchema), content.createTrack);
router.patch('/learn/tracks/:id', validate(trackUpdateSchema), content.updateTrack);
router.delete('/learn/tracks/:id', content.deleteTrack);
router.post('/learn/tracks/:id/lessons', validate(lessonSchema), content.createLesson);
router.get('/learn/lessons/:id', content.getLessonAdmin);
router.patch('/learn/lessons/:id', validate(lessonUpdateSchema), content.updateLesson);
router.delete('/learn/lessons/:id', content.deleteLesson);

export default router;
