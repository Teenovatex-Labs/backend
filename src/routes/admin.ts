import { Router } from 'express';
import { listAudit, listReports, listUsers, resolveReport, setRole, stats, suspendUser, unsuspendUser } from '../controllers/admin.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { resolveReportSchema, roleSchema, suspendSchema } from '../schemas/safety.js';

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

export default router;
