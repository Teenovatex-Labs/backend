import { z } from 'zod';

export const changePasswordSchema = z.object({
  // Optional: a Google-only account has no password yet, so there's nothing
  // to confirm the first time one is set. The controller still requires and
  // verifies it whenever the account already has a password_hash.
  current_password: z.string().min(1).optional(),
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

// Password accounts confirm with their password; Google-only accounts (no password) confirm
// by signing in with Google again, so nobody can delete one with a made-up string.
export const deleteAccountSchema = z
  .object({ password: z.string().min(1).optional(), id_token: z.string().min(1).optional() })
  .refine((v) => v.password || v.id_token, { message: 'Confirm with your password or Google' });
