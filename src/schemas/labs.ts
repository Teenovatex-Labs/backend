import { z } from 'zod';

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date and time');
export const STATUSES = ['backlog', 'in_progress', 'testing', 'done'] as const;

export const createUpdateSchema = z.object({
  title: z.string().trim().min(3, 'Give the update a title (3+ characters)').max(120),
  body: z.string().trim().min(3, 'Write a little more').max(4000),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(2, 'Name the task').max(140),
  notes: z.string().trim().max(2000).optional(),
  status: z.enum(STATUSES).optional(),
  due_at: isoDate.nullable().optional(),
  assignee: z.string().min(3).max(30).nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(2).max(140).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  // Where in its column the card sits (0 = top). Only used together with `status`.
  position: z.number().int().min(0).max(1000).optional(),
  due_at: isoDate.nullable().optional(),
  assignee: z.string().min(3).max(30).nullable().optional(),
});

export const createMilestoneSchema = z.object({
  title: z.string().trim().min(2, 'Name the milestone').max(140),
  due_at: isoDate.nullable().optional(),
});
export const updateMilestoneSchema = z.object({
  title: z.string().trim().min(2).max(140).optional(),
  due_at: isoDate.nullable().optional(),
  done: z.boolean().optional(),
});

export const joinRequestSchema = z.object({ message: z.string().trim().max(500).optional() });
