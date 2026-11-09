import { Router } from 'express';
import { createCohort, createTestCohort, listCohorts, purgeCohort, releaseCohort, updateCohort } from '../controllers/adminCohorts.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createCohortSchema, createTestCohortSchema, releaseSchema, updateCohortSchema } from '../schemas/admissions.js';

const router = Router();
router.use(requireAuth, requirePermission('applications.window'));

router.get('/', listCohorts);
router.post('/', validate(createCohortSchema), createCohort);
router.post('/test', validate(createTestCohortSchema), createTestCohort);
router.delete('/:id', purgeCohort);
router.patch('/:id', validate(updateCohortSchema), updateCohort);
router.post('/:id/release', validate(releaseSchema), releaseCohort);

export default router;
