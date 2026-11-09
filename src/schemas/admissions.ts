import { z } from 'zod';
import { isValidBirthDate } from '../lib/age.js';
import { CRITERIA } from '../lib/rubric.js';

const phone = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid WhatsApp number');
const text = (max: number, label: string) => z.string().trim().min(1, `${label} is required`).max(max);
const optionalUrl = z.string().trim().url('Enter a full link starting with https://').max(300).nullable().optional();
const list = z.array(z.string().trim().min(1).max(60)).max(16);

export const startApplicationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  full_name: text(120, 'Full name'),
  birth_date: z.string().refine((v) => isValidBirthDate(v), 'Enter a real date of birth'),
  country: text(80, 'Country'),
  city: text(80, 'State or city'),
  whatsapp: phone,
  school: z.string().trim().max(160).nullable().optional(),
  education_level: text(60, 'Education level'),
  test_key: z.string().trim().min(10).max(80).optional(),
});

export const updateDraftSchema = z
  .object({
    full_name: text(120, 'Full name'),
    birth_date: z.string().refine((v) => isValidBirthDate(v), 'Enter a real date of birth'),
    country: text(80, 'Country'),
    city: text(80, 'State or city'),
    whatsapp: phone,
    school: z.string().trim().max(160).nullable(),
    education_level: text(60, 'Education level'),
    interests: list,
    skill_level: z.enum(['beginner', 'intermediate', 'advanced']).nullable(),
    skill_level_note: z.string().trim().max(600).nullable(),
    current_skills: list,
    learning_goals: list,
    portfolio_url: optionalUrl,
    github_url: optionalUrl,
    linkedin_url: optionalUrl,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const resumeSchema = z.object({ token: z.string().min(32).max(200) });
export const reminderSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) });

export const createCohortSchema = z.object({
  opens_at: z.coerce.date(),
  closes_at: z.coerce.date(),
  decisions_publish_at: z.coerce.date(),
  target_size: z.number().int().min(1).max(10000).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const updateCohortSchema = createCohortSchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');


// null means "insufficient evidence": left out of the weighted score rather than counted as a 1.
const rating = z.number().int().min(1).max(5).nullable();
export const reviewSchema = z.object({
  scores: z.object(Object.fromEntries(CRITERIA.map((c) => [c, rating])) as Record<(typeof CRITERIA)[number], typeof rating>),
  recommendation: z.enum(['accept', 'decline', 'waitlist', 'shortlist']),
  note: z.string().trim().max(4000).nullable().optional(),
});

export const decisionSchema = z.object({
  decision: z.enum(['accept', 'decline', 'waitlist', 'shortlist']),
  note: z.string().trim().max(4000).nullable().optional(),
  feedback: z.string().trim().max(2000).nullable().optional(),
});

export const reverseSchema = z.object({
  decision: z.enum(['accept', 'decline', 'waitlist', 'shortlist']),
  reason: z.string().trim().min(10, 'Give a reason of at least a sentence').max(2000),
});

export const secondReviewSchema = z.object({ reviewer_id: z.string().uuid() });
export const clarificationSchema = z.object({ question: z.string().trim().min(5).max(1500) });
export const clarificationReplySchema = z.object({ response: z.string().trim().min(1).max(4000) });
export const createTestCohortSchema = z.object({
  days: z.number().int().min(1).max(14).default(7),
  note: z.string().trim().max(500).nullable().optional(),
});

export const releaseSchema = z.object({ allow_undecided: z.boolean().optional() });

export const guardianSchema = z.object({ parent_email: z.string().trim().toLowerCase().email().max(200) });

export const lookupSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) });

// A typed answer, or a pick (choice/multi), or a number (scale/slider), each with an optional note. The question decides which is valid.
export const answerSchema = z
  .object({
    answer: z.string().trim().max(2000).optional(),
    choice: z.array(z.string().trim().min(1).max(100)).max(6).optional(),
    value: z.number().int().min(0).max(10).optional(),
    note: z.string().trim().max(600).optional(),
  })
  .refine((v) => v.answer !== undefined || v.choice !== undefined || v.value !== undefined, 'Write an answer first');

export const toneSchema = z.object({ tone: z.enum(['playful', 'balanced', 'plain']) });

export const helpSchema = z.object({ action: z.enum(['hint', 'alternative', 'skip']) });

export const offerResponseSchema = z.object({ accept: z.boolean() });

export const interviewInviteSchema = z.object({ details: z.string().trim().min(10).max(800) });
