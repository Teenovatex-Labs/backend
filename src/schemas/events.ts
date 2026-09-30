import { z } from 'zod';

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date and time');

export const createEventSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(4000),
  starts_at: isoDate,
  ends_at: isoDate.optional(),
  location: z.string().max(300).optional(),
  cover_url: z.string().url().optional(),
  capacity: z.number().int().positive().max(100000).optional(),
});

export const updateEventSchema = createEventSchema.partial();
