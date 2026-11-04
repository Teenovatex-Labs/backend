import { Router } from 'express';
import { z } from 'zod';
import { awardBadge, createBadge, listBadges, revokeAward, serveBadgeSvg, updateBadge, uploadBadgeImage } from '../controllers/badges.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';

const tier = z.enum(['standard', 'high', 'top']);
const createSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes').min(2).max(60),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(300),
  tier: tier.optional(),
  criteria_text: z.string().trim().min(10).max(1200),
  repeatable: z.boolean().optional(),
});
const updateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(300),
  tier,
  criteria_text: z.string().trim().min(10).max(1200),
  active: z.boolean(),
  repeatable: z.boolean(),
}).partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');
const awardSchema = z.object({ user_id: z.string().uuid(), reason: z.string().trim().min(5).max(400), challenge_id: z.string().uuid().optional() });
const revokeSchema = z.object({ reason: z.string().trim().min(5).max(400) });
export const featuredSchema = z.object({ award_ids: z.array(z.string().uuid()).max(3) });

/** Admin: manage badge definitions and award them. */
export const adminBadgesRouter = Router();
adminBadgesRouter.use(requireAuth);
adminBadgesRouter.get('/', requirePermission('badges.manage'), listBadges);
adminBadgesRouter.post('/', requirePermission('badges.manage'), validate(createSchema), createBadge);
adminBadgesRouter.patch('/:id', requirePermission('badges.manage'), validate(updateSchema), updateBadge);
adminBadgesRouter.post('/:id/image', requirePermission('badges.manage'), upload.single('image'), uploadBadgeImage);
adminBadgesRouter.post('/:id/award', requirePermission('badges.award'), validate(awardSchema), awardBadge);

export const adminBadgeAwardsRouter = Router();
adminBadgeAwardsRouter.post('/:id/revoke', requireAuth, requirePermission('badges.award'), validate(revokeSchema), revokeAward);

/** Public artwork. A member's own featured selection lives under /users/me/badges/featured. */
export const badgesRouter = Router();
badgesRouter.get('/:slug/image.svg', serveBadgeSvg);
