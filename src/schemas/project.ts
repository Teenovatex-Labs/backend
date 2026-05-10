import { z } from 'zod';

const optionalUrl = z.string().url().optional().or(z.literal('')).or(z.undefined());

export const createProjectSchema = z.object({
  name: z.string().min(2).max(100),
  short_description: z.string().max(160),
  description: z.string().min(10),
  category: z.string().min(1),
  demo_url: optionalUrl,
  github_url: optionalUrl,
  tx_post_url: optionalUrl,
  tags: z.array(z.string()).max(10).optional(),
});

export const updateProjectSchema = createProjectSchema.partial();
