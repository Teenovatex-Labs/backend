import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const gen = vi.hoisted(() => ({ calls: [] as { system: string; user: string }[], replies: [] as (string | Error)[] }));
vi.mock('../src/lib/pet/providers.js', () => ({
  hasProviders: () => true,
  AllProvidersFailed: class extends Error {},
  generate: async (prompt: { system: string; user: string }, accept: (t: string) => boolean) => {
    gen.calls.push(prompt);
    const r = gen.replies.length > 1 ? gen.replies.shift()! : gen.replies[0]!;
    if (r instanceof Error) throw r;
    if (!accept(r)) throw new Error('rejected');
    return { text: r, provider: 'gemini' };
  },
}));

import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { newResumeToken } from '../src/lib/admissions.js';
import { critique, parseDraft, type Context, type Draft } from '../src/lib/alfred/critique.js';
import { styleOf } from '../src/lib/alfred/interview.js';
import { SYSTEM } from '../src/lib/alfred/persona.js';
import { composeAnswer } from '../src/lib/alfred/formats.js';
import { focusFor } from '../src/lib/alfred/questions.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

const ctx = (o: Partial<Context> = {}): Context => ({ past: [], tone: 'balanced', serious: false, noExperience: false, beginner: false, allowFollowUp: true, first: false, ...o });
const draft = (o: Partial<Draft> = {}): Draft => ({ reaction: null, question: 'What would you change first about your school website?', mode: 'new', shows: [], ...o });
const codes = (d: Draft, c: Context) => critique(d, c).map((p) => p.code);

describe('the quality gate', () => {
  it('accepts a specific, single question', () => expect(critique(draft(), ctx())).toEqual([]));

  it('rejects stock interview questions, slang, double questions and long ones', () => {
    expect(codes(draft({ question: 'Why do you want to join TeenovateX?' }), ctx())).toContain('generic');
    expect(codes(draft({ question: 'Tell us about a project you have worked on?' }), ctx())).toContain('generic');
    expect(codes(draft({ question: 'No cap, what would you build first?' }), ctx())).toContain('slang');
    expect(codes(draft({ question: 'What would you build? And who would use it?' }), ctx())).toContain('double');
    expect(codes(draft({ question: `${'What would you build '.repeat(20)}?` }), ctx())).toContain('long');
  });

  it('rejects links and contact details', () => {
    expect(codes(draft({ question: 'Can you message me at kid@example.com about it?' }), ctx())).toContain('contact');
  });

  it('does not let "Imagine" open two questions close together, or the first one', () => {
    const imagine = draft({ question: 'Imagine your school website is on fire. What do you save first?' });
    expect(codes(imagine, ctx({ past: [{ question: 'Imagine a robot with no off switch. What do you do?' }] }))).toContain('opener');
    expect(codes(imagine, ctx({ first: true }))).toContain('opener');
    expect(codes(imagine, ctx({ past: [{ question: 'What did you last fix?' }, { question: 'Which tool do you reach for?' }] }))).toEqual([]);
  });

  it('rejects a question too close to an earlier one', () => {
    expect(codes(draft({ question: 'What would you change first about your school website?' }), ctx({ past: [{ question: 'What would you change first about the school website?' }] }))).toContain('repeat');
  });

  it('never assumes projects for someone who said they have built nothing', () => {
    const d = draft({ question: 'What was the hardest part of your best project?' });
    expect(codes(d, ctx({ noExperience: true }))).toContain('assumes');
    expect(codes(d, ctx({ beginner: true }))).toContain('assumes');
    expect(codes(d, ctx())).not.toContain('assumes');
  });

  it('only costs the reaction when the reaction is the problem', () => {
    const praised = critique(draft({ reaction: { type: 'impressed', text: 'Wow, that is amazing!' } }), ctx());
    expect(praised.map((p) => [p.code, p.level])).toEqual([['praise', 'soft']]);
    const joke = critique(draft({ reaction: { type: 'playful', text: 'School websites are where hope goes to buffer.' } }), ctx({ tone: 'plain' }));
    expect(joke.map((p) => p.code)).toContain('plain');
    expect(critique(draft({ reaction: { type: 'playful', text: 'A tiny joke.' } }), ctx({ serious: true })).map((p) => p.code)).toContain('serious');
    expect(critique(draft({ reaction: { type: 'curious', text: 'Interesting 😭' }, question: 'What did you try next? 🔥' }), ctx()).map((p) => p.code)).toContain('emoji');
  });

  it('refuses a joke on two turns in a row', () => {
    const past = [{ question: 'Something else entirely?', reaction: 'playful The school website is a crime scene.' }];
    expect(codes(draft({ reaction: { type: 'playful', text: 'Debugging with hope is a bold strategy.' } }), ctx({ past }))).toContain('streak');
  });

  it('parses model output, ignores unknown criteria, and survives fenced JSON', () => {
    const d = parseDraft('```json\n{"reaction":{"type":"curious","text":"Hm, a radio."},"question":"What was inside it?","mode":"follow_up","shows":["curiosity_creativity","nonsense"],"format":"text"}\n```')!;
    expect(d.reaction).toEqual({ type: 'curious', text: 'Hm, a radio.' });
    expect(d.mode).toBe('follow_up');
    expect(d.shows).toEqual(['curiosity_creativity']);
    expect(parseDraft('not json')).toBeNull();
  });
});

describe('prompt and formats', () => {
  it('keeps the voice rules the product owner asked for', () => {
    expect(SYSTEM).toMatch(/no cap/);
    expect(SYSTEM).toMatch(/Never use: "That's amazing"/);
    expect(SYSTEM).toMatch(/Judge nothing about English/);
  });
  it('reads how someone writes without scoring it', () => {
    expect(styleOf([])).toBe('not enough yet');
    expect(styleOf(['yes', 'no idea'])).toMatch(/very short/);
    expect(styleOf(['haha I built a thing 😭'])).toMatch(/jokes/);
  });
  it('asks the first question about curiosity, then what is still missing, heaviest first', () => {
    expect(focusFor(1, [])).toBe('curiosity_creativity');
    expect(focusFor(2, [])).toBe('initiative_action');
    const long = 'I took apart an old radio and tried to work out how every little part did its job.';
    expect(focusFor(3, [{ criterion: 'curiosity_creativity', text: long }, { criterion: 'initiative_action', text: long }])).toBe('growth_mindset');
  });
  it('credits a rich answer for another quality it showed, but never a one-word tap', () => {
    const long = 'I redesigned our school website and then argued with the principal until he agreed to a trial.';
    expect(focusFor(3, [{ criterion: 'curiosity_creativity', text: long, signals: ['initiative_action', 'collaboration_community', 'growth_mindset'] }])).toBe('motivation_commitment');
    expect(focusFor(3, [{ criterion: 'curiosity_creativity', text: 'Yes', signals: ['initiative_action'] }])).toBe('initiative_action');
  });
  it('reads a ranking back as text and refuses an incomplete one', () => {
    const spec = { options: ['Talk to users', 'Build it', 'Ask a friend'] };
    expect(composeAnswer('rank', spec, { choice: ['Build it', 'Talk to users', 'Ask a friend'] })).toMatchObject({ ok: true, text: '1. Build it; 2. Talk to users; 3. Ask a friend' });
    expect(composeAnswer('rank', spec, { choice: ['Build it'] }).ok).toBe(false);
  });
});

const setup = async (extra: Record<string, unknown> = {}) => {
  const w = await prisma.applicationWindow.create({ data: { opens_at: new Date(Date.now() - 1e8), closes_at: new Date(Date.now() + 5e8), decisions_publish_at: new Date(Date.now() + 9e8), form_version: 'v1' } });
  const link = newResumeToken();
  const a = await prisma.application.create({
    data: { reference: 'TX-2026-00001', window_id: w.id, email: 'kid@example.com', full_name: 'Secret Name', birth_date: new Date('2009-01-01'), country: 'NG', city: 'Lagos', whatsapp: '+2348012345678', education_level: 'secondary', interests: ['design'], current_skills: [], learning_goals: [], resume_token_hash: link.hash, resume_expires_at: link.expires, ...extra },
  });
  return { a, auth: { Authorization: `Bearer ${link.token}` } };
};
const next = (auth: Record<string, string>) => request(app).post('/api/v1/applications/interview/next').set(auth);
const answer = (auth: Record<string, string>, pos: number, text: string) => request(app).put(`/api/v1/applications/interview/answers/${pos}`).set(auth).send({ answer: text });
const turn = (o: Record<string, unknown>) => JSON.stringify({ reaction: null, question: 'What is one website that makes you wonder if its designer was fighting their keyboard?', format: 'text', mode: 'new', shows: [], ...o });

beforeEach(async () => {
  await resetDb();
  gen.calls.length = 0;
  gen.replies = [turn({})];
  config.admissionsAiEnabled = true;
  config.safeguardingEmails = [];
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('Alfred turns', () => {
  it('stores the reaction with the question it introduces and shows it to the applicant only', async () => {
    const { auth, a } = await setup();
    await next(auth);
    gen.replies = [turn({ reaction: { type: 'playful', text: 'School websites: the final bosses of unnecessary suffering.' }, question: 'What is the first thing you would change about yours?', mode: 'follow_up', shows: ['curiosity_creativity'] })];
    await answer(auth, 1, 'My school website, it takes forever to load and the menu hides everything.');
    const q = await next(auth);
    expect(q.body.next).toMatchObject({ kind: 'follow_up', lead_in: { type: 'playful', text: expect.stringContaining('final bosses') } });
    const rows = await prisma.applicationAnswer.findMany({ where: { application_id: a.id }, orderBy: { position: 'asc' } });
    expect(rows[0]!.signals).toEqual(['curiosity_creativity']);
    expect(rows[1]).toMatchObject({ kind: 'follow_up', criterion: 'curiosity_creativity', lead_in_type: 'playful' });
    // The first turn has nothing to react to.
    expect(rows[0]!.lead_in_text).toBeNull();
  });

  it('retries once with the reasons, and uses the better draft', async () => {
    const { auth } = await setup();
    await next(auth);
    await answer(auth, 1, 'My school website, it takes forever to load.');
    gen.calls.length = 0;
    gen.replies = [turn({ question: 'Why do you want to join TeenovateX?' }), turn({ question: 'You get one hour and root access to the school site. What breaks first?' })];
    const q = await next(auth);
    expect(q.body.next.question).toMatch(/root access/);
    expect(gen.calls).toHaveLength(2);
    expect(gen.calls[1]!.user).toMatch(/PREVIOUS DRAFT WAS REJECTED/);
    expect(gen.calls[1]!.user).toMatch(/stock interview question/);
  });

  it('falls back to the bank when both drafts are bad', async () => {
    const { auth, a } = await setup();
    await next(auth);
    await answer(auth, 1, 'My school website, it takes forever to load.');
    gen.replies = [turn({ question: 'Why do you want to join TeenovateX?' })];
    await next(auth);
    const rows = await prisma.applicationAnswer.findMany({ where: { application_id: a.id }, orderBy: { position: 'asc' } });
    expect(rows[1]!.source).toBe('fallback');
  });

  it('keeps the question but drops a reaction that breaks the voice rules', async () => {
    const { auth } = await setup();
    await next(auth);
    await answer(auth, 1, 'My school website, it takes forever to load.');
    gen.replies = [turn({ reaction: { type: 'impressed', text: 'Wow, that is amazing!' }, question: 'Which page would you fix first, and what would you cut?' })];
    // Soft problems do not earn a retry that could lose the good question; the reaction just disappears.
    const q = await next(auth);
    expect(q.body.next.lead_in).toBeNull();
    expect(q.body.next.question).toMatch(/which page/i);
  });

  it('never reacts to, or asks AI about, a sensitive answer', async () => {
    const { auth } = await setup();
    await next(auth);
    gen.calls.length = 0;
    const r = await answer(auth, 1, 'honestly I want to die');
    expect(r.body.safety_message).toBeTruthy();
    const q = await next(auth);
    expect(q.body.next).toBeNull();
    expect(gen.calls).toHaveLength(0);
  });

  it('lets the applicant choose how Alfred talks, and tells the model', async () => {
    const { auth, a } = await setup();
    const t = await request(app).put('/api/v1/applications/interview/tone').set(auth).send({ tone: 'plain' });
    expect(t.status).toBe(200);
    expect(t.body.tone).toBe('plain');
    expect((await request(app).put('/api/v1/applications/interview/tone').set(auth).send({ tone: 'chaos' })).status).toBe(400);
    await next(auth);
    expect(gen.calls[0]!.user).toMatch(/TONE plain/);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: a.id } })).alfred_tone).toBe('plain');
  });

  it('does not allow follow-ups when the questions left are needed for criteria still uncovered', async () => {
    const { auth } = await setup();
    await next(auth);
    await answer(auth, 1, 'My school website, it takes forever to load and the menu hides everything.');
    await next(auth);
    expect(gen.calls.at(-1)!.user).toMatch(/follow_up is allowed/);
  });

  it('never puts Alfred\'s words into what reviewers read', async () => {
    const { auth, a } = await setup();
    await next(auth);
    gen.replies = [turn({ reaction: { type: 'curious', text: 'A radio, really. Hm.' }, question: 'What was the first part you were scared to touch?' })];
    await answer(auth, 1, 'I took apart a radio to see how it worked.');
    await next(auth);
    const { buildEvidenceInput } = await import('../src/lib/alfred/evidence.js');
    const rows = await prisma.applicationAnswer.findMany({ where: { application_id: a.id }, orderBy: { position: 'asc' } });
    const input = buildEvidenceInput({ interests: [], skill_level: null, current_skills: [], learning_goals: [], answers: rows });
    expect(input).not.toContain('A radio, really');
  });
});
