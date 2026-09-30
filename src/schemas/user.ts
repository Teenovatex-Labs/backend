import { z } from 'zod';
import { birthDateField, timezoneField } from './auth.js';

const optionalUrl = z.string().url().optional().or(z.literal(''));

export const updateUserSchema = z.object({
  full_name: z.string().min(2).max(100).optional(),
  bio: z.string().max(200).optional(),
  timezone: timezoneField.optional(),
  social_links: z
    .object({
      twitter: optionalUrl,
      github: optionalUrl,
      linkedin: optionalUrl,
      website: optionalUrl,
    })
    .optional(),
});

export const setBirthDateSchema = z.object({ birth_date: birthDateField });
