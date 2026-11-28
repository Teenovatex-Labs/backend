import { z } from 'zod';

export const moderationQuerySchema = z
  .object({
    hidden: z.enum(['true', 'false']).optional(),
    reported: z.enum(['true', 'false']).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    cursor: z.string().uuid().optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  })
  .strict()
  .refine((query) => !query.from || !query.to || new Date(query.from) <= new Date(query.to), {
    message: 'from must be at or before to',
  });

export const moderationTargetTypeSchema = z.enum(['post', 'comment', 'lab']);
export const moderationTargetIdSchema = z.string().uuid();
