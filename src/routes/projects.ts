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
import { updateProjectSchema } from '../schemas/project.js';
import { voteLimiter, writeLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.get('/', listProjects);
router.post('/', requireAuth, writeLimiter, upload.single('cover_image'), createProject);
router.get('/:id', getProject);
router.patch('/:id', requireAuth, validate(updateProjectSchema), updateProject);
router.delete('/:id', requireAuth, deleteProject);

// Voting sub-resource
router.post('/:id/vote', requireAuth, voteLimiter, castVote);
router.delete('/:id/vote', requireAuth, removeVote);

export default router;
