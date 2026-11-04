import { Router } from 'express';
import { z } from 'zod';
import { decideReview, inactivity, listMembers, listReviews, myReview, respondToReview, setStatus, startReview } from '../controllers/membership.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const reason = z.string().trim().min(5).max(500);
const manage = requirePermission('membership.manage');

/** Mounted at /admin. */
export const adminMembershipRouter = Router();
adminMembershipRouter.use(requireAuth);
adminMembershipRouter.get('/members', manage, listMembers);
adminMembershipRouter.get('/members/inactivity', manage, inactivity);
adminMembershipRouter.post('/members/:id/status', manage, validate(z.object({ status: z.enum(['onboarding', 'active', 'on_leave', 'inactive', 'alumni', 'removed']), reason })), setStatus);
adminMembershipRouter.get('/inactivity-reviews', manage, listReviews);
adminMembershipRouter.post('/members/:id/inactivity-review', manage, validate(z.object({ reason, days: z.number().int().min(7).max(30).optional() })), startReview);
adminMembershipRouter.post('/members/:id/inactivity-review/decide', manage, validate(z.object({ decision: z.enum(['active', 'on_leave', 'alumni', 'removed']), reason })), decideReview);

export const membershipRouter = Router();
membershipRouter.use(requireAuth);
membershipRouter.get('/review', myReview);
membershipRouter.post('/review/respond', validate(z.object({ message: z.string().trim().min(2).max(1000) })), respondToReview);
