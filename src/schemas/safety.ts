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
