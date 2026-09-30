import { Router } from 'express';
import { completeLesson, getLesson, getTrack, listTracks } from '../controllers/learn.js';
import { optionalAuth, requireAgeConfirmed, requireAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.get('/tracks', optionalAuth, listTracks);
router.get('/tracks/:slug', optionalAuth, getTrack);
router.get('/tracks/:slug/lessons/:lessonSlug', optionalAuth, getLesson);
router.post('/lessons/:id/complete', requireAuth, requireAgeConfirmed, writeLimiter, completeLesson);

export default router;
