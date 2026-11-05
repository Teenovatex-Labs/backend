import { Router } from 'express';
import { z } from 'zod';
import { confirmStep, extendOnboarding, getOnboarding, profileSuggestion, saveBio, saveIntro } from '../controllers/onboarding.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const onboardingRouter = Router();
onboardingRouter.use(requireAuth);
onboardingRouter.get('/', getOnboarding);
onboardingRouter.post('/steps/:step', confirmStep);
onboardingRouter.get('/profile-suggestion', profileSuggestion);
onboardingRouter.put('/bio', validate(z.object({ bio: z.string().trim().min(10).max(200) })), saveBio);
onboardingRouter.put('/intro', validate(z.object({ intro: z.string().trim().min(20).max(500) })), saveIntro);

const extendSchema = z.object({ days: z.number().int().min(1).max(14), reason: z.string().trim().min(5).max(300) });

export const adminOnboardingRouter = Router();
adminOnboardingRouter.use(requireAuth, requirePermission('membership.manage'));
adminOnboardingRouter.post('/:id/extend', validate(extendSchema), extendOnboarding);
