import { z } from 'zod';

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(500),
  // Only same-site paths, so an announcement can never send members to another website.
  link: z.string().regex(/^\/(?!\/)[\w\-/?=&%#.]*$/, 'Links must be a path inside the app, like /events').optional(),
  expires_at: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date').optional(),
});
