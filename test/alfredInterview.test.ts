import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const gen = vi.hoisted(() => ({ calls: [] as { system: string; user: string }[], reply: '' as string | Error }));
vi.mock('../src/lib/pet/providers.js', () => ({
  hasProviders: () => true,
  AllProvidersFailed: class extends Error {},
  generate: async (prompt: { system: string; user: string }, accept: (t: string) => boolean) => {
    gen.calls.push(prompt);
    if (gen.reply instanceof Error) throw gen.reply;
    if (!accept(gen.reply)) throw new Error('rejected');
    return { text: gen.reply, provider: 'gemini' };
  },
}));

import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { newResumeToken } from '../src/lib/admissions.js';
import { acceptQuestion } from '../src/lib/alfred/interview.js';
import { PROMPT_VERSION } from '../src/lib/alfred/persona.js';
import { criterionFor } from '../src/lib/alfred/questions.js';
import { CRITERIA } from '../src/lib/rubric.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(async () => {
  await resetDb();
  gen.calls.length = 0;
  gen.reply = JSON.stringify({ question: 'You mentioned robots. What is the first thing you would teach one to do?' });
  config.admissionsAiEnabled = true;
});
afterAll(async () => {
  config.admissionsAiEnabled = true;
  await prisma.$disconnect();
});

const setup = async () => {
  const w = await prisma.applicationWindow.create({ data: { opens_at: new Date(Date.now() - 1e8), closes_at: new Date(Date.now() + 5e8), decisions_publish_at: new Date(Date.now() + 9e8), form_version: 'v1' } });
  const link = newResumeToken();
  const a = await prisma.application.create({
    data: { reference: 'TX-2026-00001', window_id: w.id, email: 'kid@example.com', full_name: 'Secret Name', birth_date: new Date('2009-01-01'), country: 'NG', city: 'Lagos', whatsapp: '+2348012345678', education_level: 'secondary', interests: ['robots'], current_skills: [], learning_goals: [], resume_token_hash: link.hash, resume_expires_at: link.expires },
  });
  return { a, auth: { Authorization: `Bearer ${link.token}` } };
};
const next = (auth: Record<string, string>) => request(app).post('/api/v1/applications/interview/next').set(auth);
const answer = (auth: Record<string, string>, pos: number, text: string) => request(app).put(`/api/v1/applications/interview/answers/${pos}`).set(auth).send({ answer: text });

describe('Alfred interview', () => {
  it('asks AI questions tied to a criterion, stores the prompt version, and sends no contact details', async () => {
    const { auth, a } = await setup();
    const q = await next(auth);
    expect(q.body.next.question).toMatch(/robots/);
    const row = await prisma.applicationAnswer.findFirstOrThrow({ where: { application_id: a.id } });
    expect(row).toMatchObject({ source: 'ai', prompt_version: PROMPT_VERSION, criterion: 'curiosity_creativity', position: 1 });
    const sent = gen.calls[0]!.system + gen.calls[0]!.user;
    expect(sent).not.toContain('Secret Name');
    expect(sent).not.toContain('kid@example.com');
    expect(sent).not.toContain('2348012345678');
  });

  it('returns the same open question rather than asking again', async () => {
    const { auth } = await setup();
    const a = await next(auth);
    const b = await next(auth);
    expect(b.body.next.position).toBe(a.body.next.position);
    expect(gen.calls).toHaveLength(1);
  });

  it('covers every rubric criterion in the first six questions for everyone', () => {
    expect(new Set([1, 2, 3, 4, 5, 6].map(criterionFor))).toEqual(new Set(CRITERIA));
  });

  it('falls back to the fixed bank when the AI fails, is off, or answers badly', async () => {
    const { auth, a } = await setup();
    gen.reply = new Error('down');
    expect((await next(auth)).body.next.question).toMatch(/figure out/);
    await answer(auth, 1, 'I took apart a radio');
    gen.reply = JSON.stringify({ question: 'Email me at x@y.com?' });
    await next(auth);
    config.admissionsAiEnabled = false;
    await answer(auth, 2, 'I built a game');
    await next(auth);
    const rows = await prisma.applicationAnswer.findMany({ where: { application_id: a.id }, orderBy: { position: 'asc' } });
    expect(rows.map((r) => r.source)).toEqual(['fallback', 'fallback', 'fallback']);
    expect(gen.calls.length).toBe(2); // none once the switch was off
  });

  it('records edits as revisions and lets a full set be submitted', async () => {
    const { auth, a } = await setup();
    config.admissionsAiEnabled = false;
    for (let i = 1; i <= 8; i++) {
      const q = await next(auth);
      expect((await answer(auth, q.body.next.position, `Answer ${i}`)).status).toBe(200);
    }
    expect((await next(auth)).body.next).toBeNull();
    await answer(auth, 1, 'A better first answer');
    const row = await prisma.applicationAnswer.findFirstOrThrow({ where: { application_id: a.id, position: 1 } });
    expect(row.revision).toBe(2);
    expect(await prisma.applicationAnswerRevision.count({ where: { answer_id: row.id } })).toBe(1);
    expect((await request(app).get('/api/v1/applications/interview').set(auth)).body).toMatchObject({ answered: 8, complete: true, can_submit: true });
  });

  it('answers a worrying message with the fixed reply, alerts staff, and stops the interview', async () => {
    const { auth, a } = await setup();
    const admin = await makeUser({ role: 'admin' });
    await next(auth);
    gen.calls.length = 0;
    const res = await answer(auth, 1, 'honestly sometimes I want to die');
    expect(res.body.safety_message).toMatch(/trust/);
    expect(res.body.can_submit).toBe(true);
    expect(await prisma.notification.count({ where: { user_id: admin.user.id, message: { contains: a.reference } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'application.safeguarding_flag' } })).toBe(1);
    expect((await next(auth)).body.next).toBeNull();
    expect(gen.calls).toHaveLength(0); // nothing about it reached a provider
  });

  it('rejects over-long answers and unknown questions', async () => {
    const { auth } = await setup();
    await next(auth);
    expect((await answer(auth, 1, 'x'.repeat(1600))).body.code).toBe('TOO_LONG');
    expect((await answer(auth, 9, 'hello')).status).toBe(404);
  });
});

describe('acceptQuestion', () => {
  it('keeps real questions and drops links, contact asks and rambling', () => {
    expect(acceptQuestion('{"question":"What would you build first if you could?"}')).toBeTruthy();
    expect(acceptQuestion('{"question":"Visit https://x.com and tell us what you think?"}')).toBeNull();
    expect(acceptQuestion('{"question":"Not a question at all really"}')).toBeNull();
    expect(acceptQuestion('not json')).toBeNull();
  });
});
