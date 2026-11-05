import { Router } from 'express';
import * as c from '../controllers/adminApplications.js';
import { reviewerLink } from '../controllers/applicationAttachments.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { clarificationSchema, decisionSchema, reverseSchema, reviewSchema, secondReviewSchema } from '../schemas/admissions.js';

const router = Router();
router.use(requireAuth, requirePermission('applications.review'));

router.get('/', c.listApplications);
router.get('/stats', c.applicationStats);
router.get('/:id', c.getApplication);
router.get('/:id/attachments/:attId/link', reviewerLink);
router.post('/:id/summary', c.summariseApplication);
router.post('/:id/evidence', c.evidenceForApplication);
router.post('/:id/claim', c.claimApplication);
router.post('/:id/review', validate(reviewSchema), c.saveReview);
router.post('/:id/second-review', validate(secondReviewSchema), c.assignSecondReviewer);
router.post('/:id/clarification', validate(clarificationSchema), c.askClarification);
router.post('/:id/decision', validate(decisionSchema), c.decide);
router.post('/:id/waitlist-offer', c.offerWaitlistPlace);
router.post('/:id/reverse', validate(reverseSchema), c.reverse);

export default router;
