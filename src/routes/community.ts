import { Router } from 'express';
import { createComment, createPost, deleteComment, deletePost, getPost, listPosts, listSpaces, react } from '../controllers/community.js';
import { optionalAuth, requireActiveMember, requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { createCommentSchema, createPostSchema } from '../schemas/community.js';

const router = Router();

router.get('/spaces', listSpaces);
router.get('/spaces/:slug/posts', optionalAuth, listPosts);
router.post('/spaces/:slug/posts', requireAuth, requireActiveMember, writeLimiter, validate(createPostSchema), createPost);

router.get('/posts/:id', optionalAuth, getPost);
router.delete('/posts/:id', requireAuth, deletePost);
router.post('/posts/:id/comments', requireAuth, requireActiveMember, writeLimiter, validate(createCommentSchema), createComment);
router.post('/posts/:id/react', requireAuth, requireActiveMember, writeLimiter, react);
router.delete('/posts/:id/react', requireAuth, react);

router.delete('/comments/:id', requireAuth, deleteComment);

export default router;
