import { Router } from 'express';
import { getMessages, listConversations, markRead, openConversation, sendMessage, unreadCount, unsend } from '../controllers/messages.js';
import { requireActiveMember, requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { messageLimiter, writeLimiter } from '../middleware/rateLimiter.js';
import { openConversationSchema, sendMessageSchema } from '../schemas/messages.js';

const router = Router();
router.use(requireAuth);

router.get('/conversations', listConversations);
router.get('/unread-count', unreadCount);
router.post('/conversations', requireActiveMember, writeLimiter, validate(openConversationSchema), openConversation);
router.get('/conversations/:id', getMessages);
router.post('/conversations/:id/messages', requireActiveMember, messageLimiter, validate(sendMessageSchema), sendMessage);
router.post('/conversations/:id/read', markRead);
router.delete('/messages/:id', unsend);

export default router;
