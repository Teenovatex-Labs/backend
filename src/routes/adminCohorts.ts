import { Router } from 'express';
import { createCohort, listCohorts, updateCohort } from '../controllers/adminCohorts.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createCohortSchema, updateCohortSchema } from '../schemas/admissions.js';

const router = Router();
router.use(requireAuth, requirePermission('applications.window'));

router.get('/', listCohorts);
router.post('/', validate(createCohortSchema), createCohort);
router.patch('/:id', validate(updateCohortSchema), updateCohort);

export default router;
