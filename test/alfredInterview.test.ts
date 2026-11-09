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
import { acceptGenerated, acceptQuestion } from '../src/lib/alfred/interview.js';
import { PROMPT_VERSION } from '../src/lib/alfred/persona.js';
import { criterionFor } from '../src/lib/alfred/questions.js';
import { CRITERIA } from '../src/lib/rubric.js';
import { makeUser } from './factories.js';
import { answerFor, resetDb } from './helpers.js';

beforeEach(async () => {
  await resetDb();
  gen.calls.length = 0;
  gen.reply = JSON.stringify({ question: 'You mentioned robots. What is the first thing you would teach one to do?' });
  config.admissionsAiEnabled = true;
  config.safeguardingEmails = [];
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
    expect(gen.calls.length).toBe(3); // the bad draft earned one retry; none once the switch was off
  });

  it('records edits as revisions and lets a full set be submitted', async () => {
    const { auth, a } = await setup();
    config.admissionsAiEnabled = false;
    for (let i = 1; i <= 10; i++) {
      const q = await next(auth);
      expect((await request(app).put(`/api/v1/applications/interview/answers/${q.body.next.position}`).set(auth).send(answerFor(q.body.next, `Answer ${i}`))).status).toBe(200);
    }
    expect((await next(auth)).body.next).toBeNull();
    await answer(auth, 1, 'A better first answer');
    const row = await prisma.applicationAnswer.findFirstOrThrow({ where: { application_id: a.id, position: 1 } });
    expect(row.revision).toBe(2);
    expect(await prisma.applicationAnswerRevision.count({ where: { answer_id: row.id } })).toBe(1);
    expect((await request(app).get('/api/v1/applications/interview').set(auth)).body).toMatchObject({ answered: 10, complete: true, can_submit: true });
  });

  it('stops early once every criterion has a real answer, but never before six questions', async () => {
    const { auth } = await setup();
    const long = 'I took apart an old radio and tried to work out how every little part did its job.';
    const asks = ['What would you rewire first inside that old radio?', 'Your chess club loses every match. Who do you move to board one?', 'A cake collapses ten minutes before the guests arrive. What now?', 'The school play has no lighting budget. What is your plan?', 'A friend wants to fix a bike with duct tape. Do you stop them?', 'Drone footage of your street looks boring. How do you make it interesting?'];
    for (let i = 1; i <= 6; i++) {
      gen.reply = JSON.stringify({ question: asks[i - 1], shows: [] });
      const q = await next(auth);
      expect(q.body.next.position).toBe(i);
      expect((await answer(auth, i, long)).body.complete).toBe(i === 6);
    }
    const done = await next(auth);
    expect(done.body.next).toBeNull();
    expect(done.body).toMatchObject({ answered: 6, complete: true, can_submit: true, total: 10 });
  });

  it('goes back to a criterion that has only thin answers, up to the maximum of eight', async () => {
    const { auth, a } = await setup();
    config.admissionsAiEnabled = false;
    const long = 'I took apart an old radio and tried to work out how every little part did its job.';
    for (let i = 1; i <= 6; i++) {
      const q = await next(auth);
      // Everything is solid except the collaboration answer (position 4); taps are not evidence either.
      const body = i === 4 ? { answer: 'Yes' } : answerFor(q.body.next, long);
      expect((await request(app).put(`/api/v1/applications/interview/answers/${q.body.next.position}`).set(auth).send(body)).status).toBe(200);
    }
    const seventh = await next(auth);
    expect(seventh.body.next.position).toBe(7);
    const rows = await prisma.applicationAnswer.findMany({ where: { application_id: a.id }, orderBy: { position: 'asc' } });
    // Growth mindset (position 3) was a slider, so it still has no real evidence and weighs most of what is missing.
    expect(rows[2]!.format).toBe('slider');
    expect(rows[6]!.criterion).toBe('growth_mindset');
  });

  it('asks choice, scale and slider questions, checks the answer fits, and reads it back as text', async () => {
    const { auth, a } = await setup();
    config.admissionsAiEnabled = false;
    await next(auth);
    await answer(auth, 1, 'I took apart a radio and tried to learn how it worked inside.');
    await next(auth);
    await answer(auth, 2, 'I built a small game with my cousin and we shared the work out.');
    const third = await next(auth);
    expect(third.body.next).toMatchObject({ position: 3, format: 'slider', spec: { min: 0, max: 10 } });
    const bad = await request(app).put('/api/v1/applications/interview/answers/3').set(auth).send({ value: 11 });
    expect(bad.status).toBe(400);
    expect((await request(app).put('/api/v1/applications/interview/answers/3').set(auth).send({ answer: 'hello' })).body.code).toBe('INVALID_ANSWER');
    const ok = await request(app).put('/api/v1/applications/interview/answers/3').set(auth).send({ value: 7, note: 'depends on the day' });
    expect(ok.status).toBe(200);
    const row = await prisma.applicationAnswer.findFirstOrThrow({ where: { application_id: a.id, position: 3 } });
    expect(row.answer).toMatchObject({ value: 7, text: expect.stringContaining('7 out of 10') });
    expect((await request(app).get('/api/v1/applications/interview').set(auth)).body.questions[2]).toMatchObject({ format: 'slider', answer: expect.stringContaining('depends on the day') });
  });

  it('accepts a format from the AI after the first question, never for the first, and never twice in a row', async () => {
    const { auth, a } = await setup();
    gen.reply = JSON.stringify({ question: 'Which of these sounds most like your first move on a new idea?', format: 'choice', options: ['Build a rough version', 'Ask a friend', 'Read about it'] });
    expect((await next(auth)).body.next).toMatchObject({ position: 1, format: 'text' });
    await answer(auth, 1, 'I took apart a radio and tried to learn how it worked inside.');
    expect((await next(auth)).body.next).toMatchObject({ position: 2, format: 'choice', spec: { options: ['Build a rough version', 'Ask a friend', 'Read about it'] } });
    await request(app).put('/api/v1/applications/interview/answers/2').set(auth).send({ choice: ['Ask a friend'] });
    gen.reply = JSON.stringify({ question: 'On a scale, how much do you like surprises in a project?', format: 'scale', low: 'not at all', high: 'love them' });
    expect((await next(auth)).body.next.format).toBe('text'); // the one before was a tap
    expect(await prisma.applicationAnswer.count({ where: { application_id: a.id } })).toBe(3);
  });

  it('answers a worrying message with the fixed reply, alerts staff, and stops the interview', async () => {
    const { auth, a } = await setup();
    const lead = await makeUser({ role: 'moderator' });
    const other = await makeUser({ role: 'admin' });
    config.safeguardingEmails = [lead.user.email];
    await next(auth);
    gen.calls.length = 0;
    const res = await answer(auth, 1, 'honestly sometimes I want to die');
    expect(res.body.safety_message).toMatch(/trust/);
    expect(res.body.can_submit).toBe(true);
    expect(await prisma.notification.count({ where: { user_id: lead.user.id, message: { contains: a.reference } } })).toBe(1);
    expect(await prisma.notification.count({ where: { user_id: other.user.id } })).toBe(0); // not every reviewer
    expect(await prisma.auditLog.count({ where: { action: 'application.safeguarding_flag' } })).toBe(1);
    expect((await next(auth)).body.next).toBeNull();
    expect(gen.calls).toHaveLength(0); // nothing about it reached a provider
  });

  it('falls back to admins only, never moderators, when no safeguarding lead is configured', async () => {
    const { auth } = await setup();
    const admin = await makeUser({ role: 'admin' });
    const mod = await makeUser({ role: 'moderator' });
    await next(auth);
    await answer(auth, 1, 'I have been thinking about suicide');
    expect(await prisma.notification.count({ where: { user_id: admin.user.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { user_id: mod.user.id } })).toBe(0);
  });

  it('rejects over-long answers and unknown questions', async () => {
    const { auth } = await setup();
    await next(auth);
    expect((await answer(auth, 1, 'x'.repeat(1600))).body.code).toBe('TOO_LONG');
    expect((await answer(auth, 9, 'hello')).status).toBe(404);
  });
});

describe('Alfred help', () => {
  const help = (auth: Record<string, string>, pos: number, action: string) => request(app).post(`/api/v1/applications/interview/${pos}/help`).set(auth).send({ action });

  it('gives a hint without changing the question', async () => {
    const { auth } = await setup();
    const q = await next(auth);
    const r = await help(auth, q.body.next.position, 'hint');
    expect(r.status).toBe(200);
    expect(r.body.hint).toMatch(/Think of a time/);
    expect(r.body.questions[0].question).toBe(q.body.next.question);
  });

  it('swaps in a different question, at most twice per question', async () => {
    const { auth, a } = await setup();
    config.admissionsAiEnabled = false;
    const q = await next(auth);
    const before = q.body.next.question;
    const r1 = await help(auth, 1, 'alternative');
    expect(r1.status).toBe(200);
    expect(r1.body.questions[0].question).not.toBe(before);
    const row = await prisma.applicationAnswer.findFirstOrThrow({ where: { application_id: a.id } });
    expect(row.criterion).toBe('curiosity_creativity');
    await help(auth, 1, 'alternative');
    expect((await help(auth, 1, 'alternative')).status).toBe(409);
  });

  it('limits skips, moves to another quality, and refuses once a question is answered', async () => {
    const { auth, a } = await setup();
    config.admissionsAiEnabled = false;
    await next(auth);
    expect((await help(auth, 1, 'skip')).status).toBe(200);
    const row = await prisma.applicationAnswer.findFirstOrThrow({ where: { application_id: a.id, position: 1 } });
    expect(row.criterion).not.toBe('curiosity_creativity');
    expect((await prisma.application.findUniqueOrThrow({ where: { id: a.id } })).alfred_skips).toBe(1);
    await help(auth, 1, 'skip');
    expect((await help(auth, 1, 'skip')).status).toBe(409);
    await answer(auth, 1, 'I took apart a radio to see how it worked');
    expect((await help(auth, 1, 'hint')).status).toBe(409);
  });
});

describe('acceptGenerated', () => {
  it('only accepts well-formed options and ranges', () => {
    const ok = (o: object) => acceptGenerated(JSON.stringify({ question: 'Which sounds most like you on a new idea?', ...o }));
    expect(ok({ format: 'choice', options: ['A thing', 'Another thing'] })?.spec).toEqual({ options: ['A thing', 'Another thing'] });
    expect(ok({ format: 'choice', options: ['Only one'] })).toBeNull();
    expect(ok({ format: 'choice', options: ['Email me at a@b.co', 'Other'] })).toBeNull();
    expect(ok({ format: 'multi', options: ['Same', 'Same'] })).toBeNull();
    expect(ok({ format: 'scale', low: 'a little', high: 'a lot' })?.spec).toEqual({ min: 1, max: 5, low: 'a little', high: 'a lot' });
    expect(ok({ format: 'bananas' })).toBeNull();
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
