import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { acceptSummary, buildInput } from '../src/lib/alfred/summary.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

const ai = vi.hoisted(() => ({ reply: '', prompts: [] as { system: string; user: string }[] }));
vi.mock('../src/lib/pet/providers.js', () => ({
  hasProviders: () => true,
  generate: async (p: { system: string; user: string }, accept: (t: string) => boolean) => {
    ai.prompts.push(p);
    if (!accept(ai.reply)) throw new Error('rejected');
    return { text: ai.reply, provider: 'gemini' };
  },
}));

beforeEach(async () => { await resetDb(); ai.prompts.length = 0; config.admissionsAiEnabled = true; config.admissionsSummaryEnabled = true; });
afterAll(() => prisma.$disconnect());

const GOOD = '- Built a small weather app with a friend.\n- Learns by watching videos and trying things.\n- Wants to learn how to build robots next.';

const seed = async (answerText = 'I built a weather app and want to build robots.') => {
  const w = await prisma.applicationWindow.create({ data: { opens_at: new Date(Date.now() - 86_400_000), closes_at: new Date(Date.now() + 86_400_000), decisions_publish_at: new Date(Date.now() + 5 * 86_400_000), form_version: 'v1' } });
  const a = await prisma.application.create({
    data: {
      reference: 'TX-2026-00001', window_id: w.id, email: 'private.person@example.com', full_name: 'Ada Obi', birth_date: new Date('2010-05-01'), country: 'Nigeria', city: 'Lagos',
      whatsapp: '+234 800 000 0000', education_level: 'secondary', status: 'submitted', submitted_at: new Date(), interests: ['robots'], resume_token_hash: 'x'.repeat(64), resume_expires_at: new Date(Date.now() + 86_400_000),
      answers: { create: [{ position: 1, question_key: 'q1', question_text: 'What have you made?', source: 'fallback', format: 'text', criterion: 'initiative_action', answer: { text: answerText } }] },
    },
  });
  return a.id;
};

describe('reviewer summary', () => {
  it('returns a labelled reading aid and sends the model no identity or contact details', async () => {
    const admin = await makeUser({ role: 'admin' });
    const id = await seed();
    ai.reply = GOOD;
    const res = await request(app).post(`/api/v1/admin/applications/${id}/summary`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.machine_written).toBe(true);
    expect(res.body.summary).toBe(GOOD);
    const sent = JSON.stringify(ai.prompts);
    expect(sent).not.toMatch(/Ada|Obi|private\.person|800 000|Lagos|Nigeria|2010/);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'application.summary' } });
    expect(JSON.stringify(log.meta)).not.toContain('weather');
  });

  it('is off by default, skips worrying answers, and refuses bad model output', async () => {
    const admin = await makeUser({ role: 'admin' });
    const id = await seed();
    config.admissionsSummaryEnabled = false;
    expect((await request(app).post(`/api/v1/admin/applications/${id}/summary`).set(admin.auth)).body.code).toBe('SUMMARY_DISABLED');
    config.admissionsSummaryEnabled = true;
    ai.reply = '- You should accept this applicant.\n- Great.\n- Email me at a@b.com';
    expect((await request(app).post(`/api/v1/admin/applications/${id}/summary`).set(admin.auth)).body.code).toBe('SUMMARY_FAILED');
    await prisma.applicationAnswer.updateMany({ data: { answer: { text: 'I want to hurt myself' } } });
    ai.reply = GOOD;
    expect((await request(app).post(`/api/v1/admin/applications/${id}/summary`).set(admin.auth)).body.code).toBe('SUMMARY_SENSITIVE');
  });

  it('is for reviewers only', async () => {
    const mod = await makeUser({ role: 'moderator' });
    const id = await seed();
    expect((await request(app).post(`/api/v1/admin/applications/${id}/summary`).set(mod.auth)).status).toBe(403);
  });

  it('accepts only plain neutral bullets', () => {
    expect(acceptSummary(GOOD)).toBe(GOOD);
    expect(acceptSummary('One paragraph that is long enough to pass the length check but is not bullet points at all.')).toBeNull();
    expect(buildInput({ interests: [], skill_level: null, current_skills: null, learning_goals: null, answers: [] })).toContain('none given');
  });
});
