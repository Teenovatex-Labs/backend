import { Router } from 'express';
import { currentWindow, getMyApplication, replyToClarification, requestReminder, startApplication, submitApplication, updateDraft, withdrawApplication } from '../controllers/admissions.js';
import { confirmConsent, requestGuardian, showConsent, withdrawConsent } from '../controllers/guardian.js';
import { requireApplicant } from '../middleware/applicant.js';
import { authLimiter, otpRequestLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/validate.js';
import { clarificationReplySchema, guardianSchema, reminderSchema, startApplicationSchema, updateDraftSchema } from '../schemas/admissions.js';

const router = Router();

router.get('/window', currentWindow);
router.post('/reminders', otpRequestLimiter, validate(reminderSchema), requestReminder);
// Sends an email to an address anyone can type, so it is limited like the other email senders.
router.post('/start', otpRequestLimiter, validate(startApplicationSchema), startApplication);

router.get('/me', authLimiter, requireApplicant, getMyApplication);
router.patch('/draft', requireApplicant, validate(updateDraftSchema), updateDraft);
router.post('/submit', requireApplicant, submitApplication);
router.post('/withdraw', requireApplicant, withdrawApplication);
router.post('/clarifications/:id/reply', requireApplicant, validate(clarificationReplySchema), replyToClarification);

// Guardian confirmation. The applicant names a guardian; the guardian acts from the emailed link, no account.
router.post('/guardian', otpRequestLimiter, requireApplicant, validate(guardianSchema), requestGuardian);
router.get('/guardian/:token', authLimiter, showConsent);
router.post('/guardian/:token/confirm', authLimiter, confirmConsent);
router.post('/guardian/:token/withdraw', authLimiter, withdrawConsent);

export default router;
