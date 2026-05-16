import { z } from 'zod';

export const adjustPointsSchema = z.object({
  amount: z.number().int().refine(val => val !== 0, {
    message: 'amount must be a non-zero integer',
  }),
  reason: z.string().min(1, 'reason is required'),
});

export const banUserSchema = z.object({
  reason: z.string().optional(),
});

export const deleteUserSchema = z.object({
  confirm: z.literal(true, {
    errorMap: () => ({ message: 'confirm: true is required' }),
  }),
});

export const updateContestStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'ended'], {
    errorMap: () => ({ message: 'status must be one of: active, paused, ended' }),
  }),
});

const winnerSchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
  rank: z.number().int().min(1, 'rank must be at least 1'),
  prize: z.string().min(1, 'prize is required'),
});

export const announceWinnersSchema = z.object({
  winners: z.array(winnerSchema).length(3, 'Exactly 3 winners must be provided'),
  announcement_message: z.string().min(1, 'announcement_message is required'),
});

export const broadcastNotificationSchema = z.object({
  type: z.enum(['announcement', 'warning', 'contest', 'feature'], {
    errorMap: () => ({ message: 'type must be one of: announcement, warning, contest, feature' }),
  }),
  message: z.string().min(1, 'message is required'),
});

export const userNotificationSchema = broadcastNotificationSchema;

export const deleteProjectSchema = z.object({
  reason: z.string().min(1, 'Must provide a reason for deletion'),
});
