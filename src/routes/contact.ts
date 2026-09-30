import { Router } from 'express';
import { submitContact } from '../controllers/contact.js';
import { validate } from '../middleware/validate.js';
import { contactLimiter } from '../middleware/rateLimiter.js';
import { contactSchema } from '../schemas/auth.js';

const router = Router();

router.post('/', contactLimiter, validate(contactSchema), submitContact);

export default router;
