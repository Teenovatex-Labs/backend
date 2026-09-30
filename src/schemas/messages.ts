import { z } from 'zod';

export const openConversationSchema = z.object({ username: z.string().min(3).max(30) });
export const sendMessageSchema = z.object({ body: z.string().trim().min(1, 'Write something first').max(2000) });
