import { Router } from 'express';
import {
  createProject,
  listProjects,
  listMyProjects,
  listCategories,
  getProject,
  updateProject,
  deleteProject,
} from '../controllers/projects.js';
import { castVote, removeVote } from '../controllers/votes.js';
import { optionalAuth, requireAgeConfirmed, requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload } from '../middleware/upload.js';
import { updateProjectSchema } from '../schemas/project.js';
import { voteLimiter, writeLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.get('/', optionalAuth, listProjects);
router.get('/mine', requireAuth, listMyProjects);
router.get('/categories', listCategories);
router.post('/', requireAuth, requireAgeConfirmed, writeLimiter, upload.single('cover_image'), createProject);
router.get('/:id', optionalAuth, getProject);
router.patch('/:id', requireAuth, validate(updateProjectSchema), updateProject);
router.delete('/:id', requireAuth, deleteProject);

// Voting sub-resource
router.post('/:id/vote', requireAuth, requireAgeConfirmed, voteLimiter, castVote);
router.delete('/:id/vote', requireAuth, removeVote);

export default router;
