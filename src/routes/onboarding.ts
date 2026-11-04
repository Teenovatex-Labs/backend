import { Router } from 'express';
import { z } from 'zod';
import { confirmStep, extendOnboarding, getOnboarding } from '../controllers/onboarding.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const onboardingRouter = Router();
onboardingRouter.use(requireAuth);
onboardingRouter.get('/', getOnboarding);
onboardingRouter.post('/steps/:step', confirmStep);

const extendSchema = z.object({ days: z.number().int().min(1).max(14), reason: z.string().trim().min(5).max(300) });

export const adminOnboardingRouter = Router();
adminOnboardingRouter.use(requireAuth, requirePermission('membership.manage'));
adminOnboardingRouter.post('/:id/extend', validate(extendSchema), extendOnboarding);
