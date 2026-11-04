import { Router } from 'express';
import { currentWindow, getMyApplication, requestReminder, startApplication, submitApplication, updateDraft, withdrawApplication } from '../controllers/admissions.js';
import { requireApplicant } from '../middleware/applicant.js';
import { authLimiter, otpRequestLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/validate.js';
import { reminderSchema, startApplicationSchema, updateDraftSchema } from '../schemas/admissions.js';

const router = Router();

router.get('/window', currentWindow);
router.post('/reminders', otpRequestLimiter, validate(reminderSchema), requestReminder);
// Sends an email to an address anyone can type, so it is limited like the other email senders.
router.post('/start', otpRequestLimiter, validate(startApplicationSchema), startApplication);

router.get('/me', authLimiter, requireApplicant, getMyApplication);
router.patch('/draft', requireApplicant, validate(updateDraftSchema), updateDraft);
router.post('/submit', requireApplicant, submitApplication);
router.post('/withdraw', requireApplicant, withdrawApplication);

export default router;
