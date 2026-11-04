import { Router } from 'express';
import { createCohort, listCohorts, releaseCohort, updateCohort } from '../controllers/adminCohorts.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createCohortSchema, releaseSchema, updateCohortSchema } from '../schemas/admissions.js';

const router = Router();
router.use(requireAuth, requirePermission('applications.window'));

router.get('/', listCohorts);
router.post('/', validate(createCohortSchema), createCohort);
router.patch('/:id', validate(updateCohortSchema), updateCohort);
router.post('/:id/release', validate(releaseSchema), releaseCohort);

export default router;
