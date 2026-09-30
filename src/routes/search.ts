import { Router } from 'express';
import { search } from '../controllers/search.js';
import { optionalAuth } from '../middleware/auth.js';
import { searchLimiter } from '../middleware/rateLimiter.js';

const router = Router();
router.get('/', optionalAuth, searchLimiter, search);

export default router;
