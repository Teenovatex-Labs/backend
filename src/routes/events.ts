import { Router } from 'express';
import { cancelRsvp, createEvent, deleteEvent, getEvent, listEvents, rsvp, updateEvent } from '../controllers/events.js';
import { optionalAuth, requireAgeConfirmed, requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { createEventSchema, updateEventSchema } from '../schemas/events.js';

const router = Router();
const staff = requireRole('moderator', 'admin');

router.get('/', optionalAuth, listEvents);
router.get('/:id', optionalAuth, getEvent);
router.post('/', requireAuth, staff, validate(createEventSchema), createEvent);
router.patch('/:id', requireAuth, staff, validate(updateEventSchema), updateEvent);
router.delete('/:id', requireAuth, staff, deleteEvent);
router.post('/:id/rsvp', requireAuth, requireAgeConfirmed, writeLimiter, rsvp);
router.delete('/:id/rsvp', requireAuth, cancelRsvp);

export default router;
