import { z } from 'zod';

export const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z
    .string()
    .min(8)
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain a number'),
});

export const updateNotificationsSchema = z.object({
  email_notifications: z.boolean().optional(),
  vote_alerts: z.boolean().optional(),
  contest_updates: z.boolean().optional(),
  public_profile: z.boolean().optional(),
});

export const deleteAccountSchema = z.object({ password: z.string().min(1) });
