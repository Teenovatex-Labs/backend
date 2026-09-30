import { z } from 'zod';
import { isValidBirthDate, isValidTimezone } from '../lib/age.js';

export const birthDateField = z
  .string()
  .refine((v) => isValidBirthDate(v), 'Enter a real date of birth (YYYY-MM-DD)');

export const timezoneField = z.string().refine(isValidTimezone, 'Unknown time zone');

const strongPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const registerSchema = z.object({
  full_name: z.string().min(2).max(100),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username: letters, numbers, underscores only'),
  email: z.string().email(),
  password: strongPassword,
  birth_date: birthDateField,
  timezone: timezoneField.optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({ refresh_token: z.string() });

export const googleAuthSchema = z.object({ id_token: z.string() });

export const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6).regex(/^\d+$/, 'Code must be 6 digits'),
});

export const resendVerificationSchema = z.object({ email: z.string().email() });

export const forgotPasswordSchema = z.object({ email: z.string().email() });

export const verifyResetCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6).regex(/^\d+$/, 'Code must be 6 digits'),
});

export const resetPasswordSchema = z.object({
  token: z.string(),
  new_password: strongPassword,
});

export const CONTACT_TOPICS = ['hello', 'partner', 'sponsor', 'mentor', 'donate', 'press', 'other'] as const;

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Tell us your name').max(100),
  email: z.string().trim().email('Enter a valid email'),
  topic: z.enum(CONTACT_TOPICS).default('hello'),
  message: z.string().trim().min(10, 'Say a little more (10 characters minimum)').max(2000),
  // Honeypot: real people never see or fill this; bots do.
  website: z.string().max(200).optional(),
});
