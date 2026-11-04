import { z } from 'zod';
import { birthDateField, timezoneField, usernameField } from './auth.js';

const optionalUrl = z.string().url().optional().or(z.literal(''));

const topics = z
  .array(z.string().trim().toLowerCase().min(2).max(30))
  .max(10)
  .transform((a) => [...new Set(a)]);

export const updateUserSchema = z.object({
  full_name: z.string().min(2).max(100).optional(),
  bio: z.string().max(200).optional(),
  timezone: timezoneField.optional(),
  interests: topics.optional(),
  skills: topics.optional(),
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

export const setUsernameSchema = z.object({ username: usernameField });
