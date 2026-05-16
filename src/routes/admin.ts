import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/error.js';
import { getAdminStats } from '../controllers/admin.js';
import {
  listUsers,
  getUserById,
  banUser,
  unbanUser,
  adjustPoints,
  deleteUser,
} from '../controllers/adminUsers.js';
import {
  listProjects,
  listFlaggedProjects,
  featureProject,
  unfeatureProject,
  deleteProject as deleteAdminProject,
} from '../controllers/adminProjects.js';
import { listVotes, deleteVote } from '../controllers/adminVotes.js';
import { broadcastNotification, userNotification } from '../controllers/adminNotify.js';
import { getContestState, updateContestStatus, announceWinners } from '../controllers/adminContest.js';
import {
  adjustPointsSchema,
  banUserSchema,
  deleteUserSchema,
  updateContestStatusSchema,
  announceWinnersSchema,
  broadcastNotificationSchema,
  userNotificationSchema,
  deleteProjectSchema,
} from '../schemas/admin.js';

const router = Router();

// Apply requireAuth then requireAdmin to every admin route
router.use(asyncHandler(requireAuth), asyncHandler(requireAdmin));

// ─── Stats ────────────────────────────────────────────────────────────────────
router.get('/stats', asyncHandler(getAdminStats));

// ─── User management ─────────────────────────────────────────────────────────
router.get('/users',              asyncHandler(listUsers));
router.get('/users/:id',          asyncHandler(getUserById));
router.patch('/users/:id/ban',    validate(banUserSchema), asyncHandler(banUser));
router.patch('/users/:id/unban',  asyncHandler(unbanUser));
router.patch('/users/:id/points', validate(adjustPointsSchema), asyncHandler(adjustPoints));
router.delete('/users/:id',       validate(deleteUserSchema), asyncHandler(deleteUser));

// ─── Project management ──────────────────────────────────────────────────────
router.get('/projects',               asyncHandler(listProjects));
router.get('/projects/flagged',       asyncHandler(listFlaggedProjects));
router.patch('/projects/:id/feature', asyncHandler(featureProject));
router.patch('/projects/:id/unfeature', asyncHandler(unfeatureProject));
router.delete('/projects/:id',        validate(deleteProjectSchema), asyncHandler(deleteAdminProject));

// ─── Vote management ─────────────────────────────────────────────────────────
router.get('/votes',                  asyncHandler(listVotes));
router.delete('/votes/:id',           asyncHandler(deleteVote));

// ─── Notifications ───────────────────────────────────────────────────────────
router.post('/notify/broadcast',      validate(broadcastNotificationSchema), asyncHandler(broadcastNotification));
router.post('/notify/user/:userId',   validate(userNotificationSchema), asyncHandler(userNotification));

// ─── Contest management ──────────────────────────────────────────────────────
router.get('/contest',                asyncHandler(getContestState));
router.patch('/contest/status',       validate(updateContestStatusSchema), asyncHandler(updateContestStatus));
router.post('/contest/winners',       validate(announceWinnersSchema), asyncHandler(announceWinners));

export default router;
