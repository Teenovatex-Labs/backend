import { z } from 'zod';

const optionalUrl = z.string().url().optional().or(z.literal(''));

export const updateUserSchema = z.object({
  full_name: z.string().min(2).max(100).optional(),
  bio: z.string().max(200).optional(),
  social_links: z
    .object({
      twitter: optionalUrl,
      github: optionalUrl,
      linkedin: optionalUrl,
      website: optionalUrl,
    })
    .optional(),
});
