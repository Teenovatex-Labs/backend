import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { parseEvidence } from '../src/lib/alfred/evidence.js';
import { CRITERIA } from '../src/lib/rubric.js';
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

beforeEach(async () => {
  await resetDb();
  ai.prompts.length = 0;
  config.admissionsAiEnabled = true;
  config.admissionsSummaryEnabled = true;
  config.suggestedRatings = 'after_review';
});
afterAll(() => prisma.$disconnect());

const ANSWER = 'I built a weather app with a friend and I want to learn how to build robots next.';

const seed = async () => {
  const w = await prisma.applicationWindow.create({ data: { opens_at: new Date(Date.now() - 86_400_000), closes_at: new Date(Date.now() + 86_400_000), decisions_publish_at: new Date(Date.now() + 5 * 86_400_000), form_version: 'v1' } });
  const a = await prisma.application.create({
    data: {
      reference: 'TX-2026-00001', window_id: w.id, email: 'private.person@example.com', full_name: 'Ada Obi', birth_date: new Date('2010-05-01'), country: 'Nigeria', city: 'Lagos',
      whatsapp: '+234 800 000 0000', education_level: 'secondary', status: 'submitted', submitted_at: new Date(), interests: ['robots'], resume_token_hash: 'x'.repeat(64), resume_expires_at: new Date(Date.now() + 86_400_000),
      answers: { create: [{ position: 1, question_key: 'q1', question_text: 'What have you made?', source: 'fallback', format: 'text', criterion: 'initiative_action', answer: { text: ANSWER } }] },
    },
  });
  return a;
};

const reply = (over: Record<string, object> = {}) =>
  JSON.stringify({
    criteria: Object.fromEntries(
      CRITERIA.map((c) => [c, c === 'initiative_action'
        ? { evidence: [{ position: 1, quote: 'built a weather app with a friend' }, { position: 1, quote: 'won a national award' }], explanation: 'Made a small app together with someone else.', gap: null, suggested_rating: 4 }
        : { evidence: [], explanation: '', gap: 'Not mentioned.', suggested_rating: 3 }]),
    ),
    ...over,
  });

describe('evidence by criterion', () => {
  it('drops quotes that are not in the answers, never rates a criterion without evidence, and sends no identity', async () => {
    const admin = await makeUser({ role: 'admin' });
    const a = await seed();
    ai.reply = reply();
    const res = await request(app).post(`/api/v1/admin/applications/${a.id}/evidence`).set(admin.auth);
    expect(res.status).toBe(200);
    const init = res.body.criteria.find((c: { criterion: string }) => c.criterion === 'initiative_action');
    expect(init.evidence).toEqual([{ position: 1, quote: 'built a weather app with a friend' }]);
    expect(res.body.criteria.find((c: { criterion: string }) => c.criterion === 'growth_mindset')).toMatchObject({ evidence: [], suggested_rating: null, gap: 'Not mentioned.' });
    expect(JSON.stringify(ai.prompts)).not.toMatch(/Ada|Obi|private\.person|800 000|Lagos|Nigeria|2010/);
  });

  it('holds suggested ratings back until the reviewer has saved their own, then shows them', async () => {
    const admin = await makeUser({ role: 'admin' });
    const a = await seed();
    ai.reply = reply();
    const before = await request(app).post(`/api/v1/admin/applications/${a.id}/evidence`).set(admin.auth);
    expect(before.body).toMatchObject({ suggestions_visible: false, suggestions_hidden_until_review: true });
    expect(before.body.criteria.every((c: { suggested_rating: number | null }) => c.suggested_rating === null)).toBe(true);

    await prisma.applicationReview.create({ data: { application_id: a.id, reviewer_id: admin.user.id, kind: 'first', scores: {}, weighted_score: 3, recommendation: 'shortlist', submitted_at: new Date() } });
    const after = await request(app).post(`/api/v1/admin/applications/${a.id}/evidence`).set(admin.auth);
    expect(after.body.suggestions_visible).toBe(true);
    expect(after.body.criteria.find((c: { criterion: string }) => c.criterion === 'initiative_action').suggested_rating).toBe(4);
  });

  it('can be switched to always show or never show suggestions', async () => {
    const admin = await makeUser({ role: 'admin' });
    const a = await seed();
    ai.reply = reply();
    config.suggestedRatings = 'always';
    expect((await request(app).post(`/api/v1/admin/applications/${a.id}/evidence`).set(admin.auth)).body.suggestions_visible).toBe(true);
    config.suggestedRatings = 'off';
    const off = await request(app).post(`/api/v1/admin/applications/${a.id}/evidence`).set(admin.auth);
    expect(off.body.suggestions_visible).toBe(false);
    expect(off.body.suggestions_hidden_until_review).toBe(false);
  });

  it('is off with the summary switch, skips worrying answers, and refuses unusable output', async () => {
    const admin = await makeUser({ role: 'admin' });
    const a = await seed();
    ai.reply = reply();
    config.admissionsSummaryEnabled = false;
    expect((await request(app).post(`/api/v1/admin/applications/${a.id}/evidence`).set(admin.auth)).body.code).toBe('EVIDENCE_DISABLED');
    config.admissionsSummaryEnabled = true;
    ai.reply = 'not json';
    expect((await request(app).post(`/api/v1/admin/applications/${a.id}/evidence`).set(admin.auth)).body.code).toBe('EVIDENCE_FAILED');
    await prisma.applicationAnswer.updateMany({ data: { answer: { text: 'I want to hurt myself' } } });
    ai.reply = reply();
    expect((await request(app).post(`/api/v1/admin/applications/${a.id}/evidence`).set(admin.auth)).body.code).toBe('EVIDENCE_SENSITIVE');
  });

  it('is for reviewers only', async () => {
    const mod = await makeUser({ role: 'moderator' });
    const a = await seed();
    expect((await request(app).post(`/api/v1/admin/applications/${a.id}/evidence`).set(mod.auth)).status).toBe(403);
  });

  it('parses fenced JSON and rejects a reply missing a criterion', () => {
    const answers = [{ position: 1, answer: { text: ANSWER } }];
    expect(parseEvidence('```json\n' + reply() + '\n```', answers)).toHaveLength(6);
    const missing = JSON.parse(reply());
    delete missing.criteria.growth_mindset;
    expect(parseEvidence(JSON.stringify(missing), answers)).toBeNull();
  });
});
