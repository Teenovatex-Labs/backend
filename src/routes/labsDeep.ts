import { Router } from 'express';
import * as c from '../controllers/labsDeep.js';
import { openLabChat } from '../controllers/messages.js';
import { optionalAuth, requireActiveMember, requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { createMilestoneSchema, createTaskSchema, createUpdateSchema, joinRequestSchema, updateMilestoneSchema, updateTaskSchema } from '../schemas/labs.js';

// Mounted under /projects, so these are /projects/:id/updates, /projects/:id/board, and so on.
const router = Router();
const active = [requireAuth, requireActiveMember];

router.get('/mine/tasks', requireAuth, c.myTasks);

router.get('/:id/updates', optionalAuth, c.listUpdates);
router.post('/:id/updates', ...active, writeLimiter, validate(createUpdateSchema), c.createUpdate);
router.delete('/:id/updates/:uid', requireAuth, c.deleteUpdate);

router.get('/:id/board', requireAuth, c.getBoard);
router.post('/:id/tasks', ...active, validate(createTaskSchema), c.createTask);
router.patch('/:id/tasks/:tid', ...active, validate(updateTaskSchema), c.updateTask);
router.delete('/:id/tasks/:tid', requireAuth, c.deleteTask);

router.get('/:id/milestones', optionalAuth, c.listMilestones);
router.post('/:id/milestones', ...active, validate(createMilestoneSchema), c.createMilestone);
router.patch('/:id/milestones/:mid', ...active, validate(updateMilestoneSchema), c.updateMilestone);
router.delete('/:id/milestones/:mid', requireAuth, c.deleteMilestone);

router.post('/:id/chat', ...active, openLabChat);
router.get('/:id/team', optionalAuth, c.getTeam);
router.post('/:id/join', ...active, writeLimiter, validate(joinRequestSchema), c.requestToJoin);
router.post('/:id/requests/:rid/accept', requireAuth, c.answerRequest);
router.post('/:id/requests/:rid/decline', requireAuth, c.answerRequest);
router.delete('/:id/members/:username', requireAuth, c.removeMember);

export default router;
