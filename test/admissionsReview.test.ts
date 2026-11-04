import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { hashToken } from '../src/lib/tokens.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

const sent = vi.hoisted(() => ({ accept: [] as string[], decline: 0, wait: 0 }));
vi.mock('../src/lib/admissionsEmail.js', () => ({
  sendApplicationLink: async () => {}, sendApplicationReceived: async () => {}, sendApplicationReminderOpen: async () => {},
  sendClarificationRequest: async () => {},
  sendAcceptance: async (_e: string, t: string) => { sent.accept.push(t); },
  sendDecline: async () => { sent.decline++; },
  sendWaitlisted: async () => { sent.wait++; },
}));

beforeEach(async () => { await resetDb(); sent.accept.length = 0; sent.decline = 0; sent.wait = 0; });
afterAll(() => prisma.$disconnect());

const DAY = 86_400_000;
const TOKEN = 'a'.repeat(64);
const scores = { curiosity_creativity: 5, initiative_action: 4, growth_mindset: 3, collaboration_community: 2, motivation_commitment: 1, problem_solving_impact: 5 };

const setup = async (windowOver: Record<string, unknown> = {}) => {
  const window = await prisma.applicationWindow.create({
    data: { opens_at: new Date(Date.now() - 20 * DAY), closes_at: new Date(Date.now() - 10 * DAY), decisions_publish_at: new Date(Date.now() - DAY), form_version: 'v1', ...windowOver },
  });
  const make = (n: number, over: Record<string, unknown> = {}) =>
    prisma.application.create({
      data: {
        reference: `TX-2026-0000${n}`, window_id: window.id, status: 'submitted', submitted_at: new Date(), email: `a${n}@example.com`, email_verified_at: new Date(),
        full_name: `Applicant ${n}`, birth_date: new Date('2010-01-01'), country: 'NG', city: 'Lagos', whatsapp: '+2340000000', education_level: 'secondary',
        interests: ['ai'], current_skills: [], learning_goals: [], resume_token_hash: hashToken(TOKEN + n), resume_expires_at: new Date(Date.now() + DAY), ...over,
      },
    });
  const a1 = await makeUser({ role: 'admin' });
  const a2 = await makeUser({ role: 'admin' });
  return { window, make, a1, a2 };
};
const api = (p: string) => `/api/v1/admin/applications${p}`;
const review = (id: string, who: { auth: Record<string, string> }, rec = 'accept') =>
  request(app).post(api(`/${id}/review`)).set(who.auth).send({ scores, recommendation: rec });

describe('review flow', () => {
  it('is admin-only and hides drafts', async () => {
    const { make, a1 } = await setup();
    await make(1); await make(2, { status: 'draft' });
    const mod = await makeUser({ role: 'moderator' });
    expect((await request(app).get(api('/')).set(mod.auth)).status).toBe(403);
    const list = await request(app).get(api('/')).set(a1.auth);
    expect(list.body.items).toHaveLength(1);
  });

  it('lets only one admin claim, then locks the application', async () => {
    const { make, a1, a2 } = await setup();
    const a = await make(1);
    expect((await request(app).post(api(`/${a.id}/claim`)).set(a1.auth)).status).toBe(200);
    const again = await request(app).post(api(`/${a.id}/claim`)).set(a2.auth);
    expect(again.body.code).toBe('ALREADY_CLAIMED');
    const row = await prisma.application.findUniqueOrThrow({ where: { id: a.id } });
    expect([row.status, row.locked_at !== null]).toEqual(['under_review', true]);
  });

  it('scores with the agreed weights and keeps reviews with the reviewer', async () => {
    const { make, a1, a2 } = await setup();
    const a = await make(1);
    await request(app).post(api(`/${a.id}/claim`)).set(a1.auth);
    expect((await review(a.id, a2)).body.code).toBe('NOT_YOUR_REVIEW');
    const ok = await review(a.id, a1);
    expect(ok.body.weighted_score).toBe(3.5);
  });

  it('makes the second review blind and waits for it before deciding', async () => {
    const { make, a1, a2 } = await setup();
    const a = await make(1);
    await request(app).post(api(`/${a.id}/claim`)).set(a1.auth);
    await request(app).post(api(`/${a.id}/second-review`)).set(a1.auth).send({ reviewer_id: a2.user.id });
    await review(a.id, a1, 'accept');
    const decide = () => request(app).post(api(`/${a.id}/decision`)).set(a1.auth).send({ decision: 'accept' });
    expect((await decide()).body.code).toBe('SECOND_REVIEW_PENDING');
    // The second reviewer cannot see the first review until they have saved their own.
    expect((await request(app).get(api(`/${a.id}`)).set(a2.auth)).body.reviews).toHaveLength(0);
    await review(a.id, a2, 'decline');
    const seen = await request(app).get(api(`/${a.id}`)).set(a2.auth);
    expect(seen.body.reviews).toHaveLength(2);
    expect(seen.body.reviews_disagree).toBe(true);
    expect((await decide()).status).toBe(200);
  });

  it('records every view in the audit log', async () => {
    const { make, a1 } = await setup();
    const a = await make(1);
    await request(app).get(api(`/${a.id}`)).set(a1.auth);
    expect(await prisma.auditLog.count({ where: { action: 'application.view' } })).toBe(1);
  });

  it('requires your own review before deciding', async () => {
    const { make, a1 } = await setup();
    const a = await make(1);
    await request(app).post(api(`/${a.id}/claim`)).set(a1.auth);
    const res = await request(app).post(api(`/${a.id}/decision`)).set(a1.auth).send({ decision: 'accept' });
    expect(res.body.code).toBe('REVIEW_REQUIRED');
  });
});

describe('clarifications', () => {
  it('lets the applicant answer once, within the time', async () => {
    const { make, a1 } = await setup();
    const a = await make(1);
    await request(app).post(api(`/${a.id}/claim`)).set(a1.auth);
    const q = await request(app).post(api(`/${a.id}/clarification`)).set(a1.auth).send({ question: 'What did you build last?' });
    expect(q.status).toBe(201);
    const reply = (t: string) => request(app).post(`/api/v1/applications/clarifications/${q.body.id}/reply`).set({ Authorization: `Bearer ${t}` }).send({ response: 'A weather bot.' });
    expect((await reply(TOKEN + 1)).status).toBe(200);
    expect((await reply(TOKEN + 1)).body.code).toBe('ALREADY_ANSWERED');
  });
});

describe('releasing a cohort', () => {
  const decideAll = async (ctx: Awaited<ReturnType<typeof setup>>) => {
    const apps = [await ctx.make(1), await ctx.make(2), await ctx.make(3)];
    const decisions = ['accept', 'decline', 'waitlist'];
    for (const [i, a] of apps.entries()) {
      await request(app).post(api(`/${a.id}/claim`)).set(ctx.a1.auth);
      await review(a.id, ctx.a1);
      await request(app).post(api(`/${a.id}/decision`)).set(ctx.a1.auth).send({ decision: decisions[i] });
    }
    return apps;
  };
  const release = (id: string, who: { auth: Record<string, string> }, body = {}) =>
    request(app).post(`/api/v1/admin/cohorts/${id}/release`).set(who.auth).send(body);

  it('keeps results private before the date and refuses an early release', async () => {
    const ctx = await setup({ decisions_publish_at: new Date(Date.now() + 3 * DAY) });
    await decideAll(ctx);
    expect((await release(ctx.window.id, ctx.a1)).body.code).toBe('TOO_EARLY');
    const me = await request(app).get('/api/v1/applications/me').set({ Authorization: `Bearer ${TOKEN}1` });
    expect(me.body.status).toBe('under_review');
  });

  it('warns about undecided applications', async () => {
    const ctx = await setup();
    await ctx.make(1);
    expect((await release(ctx.window.id, ctx.a1)).body.code).toBe('UNDECIDED');
  });

  it('releases once: invitations for the accepted, retention for the declined, and is safe to repeat', async () => {
    const ctx = await setup();
    const apps = await decideAll(ctx);
    const out = await release(ctx.window.id, ctx.a1);
    expect(out.body).toMatchObject({ released: 3, invited: 1 });
    expect(sent).toMatchObject({ decline: 1, wait: 1 });
    expect(sent.accept).toHaveLength(1);

    const inv = await prisma.invitation.findFirstOrThrow();
    expect(inv).toMatchObject({ email: 'a1@example.com', role: 'member', source: 'application', used_at: null });
    expect(inv.token_hash).toBe(hashToken(sent.accept[0]!)); // only the hash is stored
    expect(inv.expires_at.getTime()).toBeGreaterThan(Date.now());
    expect((await prisma.application.findUniqueOrThrow({ where: { id: apps[1]!.id } })).retention_delete_at).not.toBeNull();

    const me = await request(app).get('/api/v1/applications/me').set({ Authorization: `Bearer ${TOKEN}1` });
    expect(me.body.status).toBe('accepted');

    const again = await release(ctx.window.id, ctx.a1);
    expect(again.body.released).toBe(0);
    expect(await prisma.invitation.count()).toBe(1);
  });

  it('reverses a decision with a reason, revokes the invitation and audits it', async () => {
    const ctx = await setup();
    const apps = await decideAll(ctx);
    await release(ctx.window.id, ctx.a1);
    const rev = (reason: string) => request(app).post(api(`/${apps[0]!.id}/reverse`)).set(ctx.a1.auth).send({ decision: 'decline', reason });
    expect((await rev('too short')).status).toBe(400);
    expect((await rev('Found a conduct issue after the decision.')).status).toBe(200);
    expect((await prisma.invitation.findFirstOrThrow()).revoked_at).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'application.reverse' } })).toBe(1);
  });
});
