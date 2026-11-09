import { Router } from 'express';
import { listWindowHistory, windowApplicants } from '../controllers/adminHistory.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
// Minors' details are in here, so both admissions permissions are needed, not one.
router.use(requireAuth, requirePermission('applications.review'), requirePermission('applications.window'));

router.get('/', listWindowHistory);
router.get('/:id/applicants', windowApplicants);

export default router;
