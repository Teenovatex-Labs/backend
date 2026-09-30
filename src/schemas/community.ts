import { z } from 'zod';

export const createPostSchema = z.object({
  title: z.string().trim().min(3, 'Give your post a title (3+ characters)').max(120),
  body: z.string().trim().min(3, 'Write a little more').max(5000),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(2000),
});
