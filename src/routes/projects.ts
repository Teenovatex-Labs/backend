import { Router } from 'express';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
} from '../controllers/projects.js';
import { castVote, removeVote } from '../controllers/votes.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload } from '../middleware/upload.js';
import { asyncHandler } from '../middleware/error.js';
import { updateProjectSchema } from '../schemas/project.js';
import { voteLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.get('/', asyncHandler(listProjects));
router.post('/', requireAuth, upload.single('cover_image'), asyncHandler(createProject));
router.get('/:id', asyncHandler(getProject));
router.patch('/:id', requireAuth, validate(updateProjectSchema), asyncHandler(updateProject));
router.delete('/:id', requireAuth, asyncHandler(deleteProject));


router.post('/:id/vote', requireAuth, voteLimiter, asyncHandler(castVote));
router.delete('/:id/vote', requireAuth, asyncHandler(removeVote));

export default router;
