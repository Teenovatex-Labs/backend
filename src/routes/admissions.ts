import { Router } from 'express';
import { answerQuestion, questionHelp, respondToOffer, viewOffer, getInterview, nextQuestion, currentWindow, getMyApplication, lookupStatus, replyToClarification, requestReminder, startApplication, submitApplication, updateDraft, withdrawApplication } from '../controllers/admissions.js';
import { confirmConsent, requestGuardian, showConsent, withdrawConsent } from '../controllers/guardian.js';
import { addLink, listMine, removeAttachment, uploadImage, uploadPdf } from '../controllers/applicationAttachments.js';
import { requireApplicant } from '../middleware/applicant.js';
import { attachmentUpload, pdfUpload } from '../middleware/upload.js';
import { z } from 'zod';
import { authLimiter, otpRequestLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/validate.js';
import { answerSchema, clarificationReplySchema, guardianSchema, helpSchema, offerResponseSchema, lookupSchema, reminderSchema, startApplicationSchema, updateDraftSchema } from '../schemas/admissions.js';

const router = Router();

router.get('/window', currentWindow);
router.post('/reminders', otpRequestLimiter, validate(reminderSchema), requestReminder);
// Sends an email to an address anyone can type, so it is limited like the other email senders.
router.post('/start', otpRequestLimiter, validate(startApplicationSchema), startApplication);

router.post('/lookup', otpRequestLimiter, validate(lookupSchema), lookupStatus);

router.get('/me', authLimiter, requireApplicant, getMyApplication);
router.get('/offer/:token', viewOffer);
router.post('/offer/:token/respond', authLimiter, validate(offerResponseSchema), respondToOffer);
router.get('/interview', requireApplicant, getInterview);
router.post('/interview/next', authLimiter, requireApplicant, nextQuestion);
router.put('/interview/answers/:position', requireApplicant, validate(answerSchema), answerQuestion);
router.post('/interview/:position/help', authLimiter, requireApplicant, validate(helpSchema), questionHelp);
router.patch('/draft', requireApplicant, validate(updateDraftSchema), updateDraft);
router.get('/attachments', requireApplicant, listMine);
router.post('/attachments/image', authLimiter, requireApplicant, attachmentUpload.single('image'), uploadImage);
router.post('/attachments/pdf', authLimiter, requireApplicant, pdfUpload.single('pdf'), uploadPdf);
router.post('/attachments/link', requireApplicant, validate(z.object({ url: z.string().trim().url().max(300).refine((u) => /^https:\/\//.test(u), 'Links must start with https://') })), addLink);
router.delete('/attachments/:id', requireApplicant, removeAttachment);
router.post('/submit', requireApplicant, submitApplication);
router.post('/withdraw', requireApplicant, withdrawApplication);
router.post('/clarifications/:id/reply', requireApplicant, validate(clarificationReplySchema), replyToClarification);

// Guardian confirmation. The applicant names a guardian; the guardian acts from the emailed link, no account.
router.post('/guardian', otpRequestLimiter, requireApplicant, validate(guardianSchema), requestGuardian);
router.get('/guardian/:token', authLimiter, showConsent);
router.post('/guardian/:token/confirm', authLimiter, confirmConsent);
router.post('/guardian/:token/withdraw', authLimiter, withdrawConsent);

export default router;
