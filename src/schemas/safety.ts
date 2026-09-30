import { z } from 'zod';

export const reportSchema = z.object({
  target_type: z.enum(['post', 'comment', 'lab', 'user', 'message']),
  target_id: z.string().min(1).max(100),
  reason: z.enum(['bullying', 'inappropriate', 'spam', 'personal_info', 'self_harm', 'unsafe_contact', 'other']),
  details: z.string().max(1000).optional(),
});

export const resolveReportSchema = z.object({
  action: z.enum(['dismiss', 'warn', 'remove', 'suspend']),
  note: z.string().max(1000).optional(),
  days: z.number().int().min(1).max(365).optional(),
});

export const suspendSchema = z.object({
  days: z.number().int().min(1).max(365),
  reason: z.string().min(3).max(500),
});

export const roleSchema = z.object({ role: z.enum(['member', 'mentor', 'moderator', 'admin']) });

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes').min(2).max(60);

export const trackSchema = z.object({ slug, title: z.string().trim().min(2).max(120), description: z.string().trim().min(5).max(500), published: z.boolean().optional() });
export const trackUpdateSchema = trackSchema.partial().extend({ position: z.number().int().min(0).max(1000).optional() });

export const lessonSchema = z.object({
  slug,
  title: z.string().trim().min(2).max(120),
  summary: z.string().trim().min(2).max(200),
  body: z.string().min(20).max(20000),
  minutes: z.number().int().min(1).max(120).optional(),
});
export const lessonUpdateSchema = lessonSchema.partial().extend({ position: z.number().int().min(0).max(1000).optional() });
