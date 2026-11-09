import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeUser } from './factories.js';
import { answerFor, resetDb } from './helpers.js';

const sent = vi.hoisted(() => ({ tokens: [] as string[], received: [] as string[] }));
vi.mock('../src/lib/admissionsEmail.js', () => ({
  sendApplicationLink: async (_e: string, t: string) => { sent.tokens.push(t); },
  sendApplicationReceived: async (_e: string, r: string) => { sent.received.push(r); },
  sendApplicationReminderOpen: async () => {},
}));

beforeEach(async () => { await resetDb(); sent.tokens.length = 0; sent.received.length = 0; });
afterAll(() => prisma.$disconnect());

const DAY = 86_400_000;
const openWindow = (over: Record<string, unknown> = {}) =>
  prisma.applicationWindow.create({
    data: { opens_at: new Date(Date.now() - DAY), closes_at: new Date(Date.now() + 5 * DAY), decisions_publish_at: new Date(Date.now() + 10 * DAY), form_version: 'v1', ...over },
  });
const body = (over: Record<string, unknown> = {}) => ({
  email: 'ada@example.com', full_name: 'Ada Obi', birth_date: '2010-05-01', country: 'Nigeria', city: 'Lagos',
  whatsapp: '+234 800 000 0000', education_level: 'secondary', ...over,
});
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const start = async (over: Record<string, unknown> = {}) => {
  const res = await request(app).post('/api/v1/applications/start').send(body(over));
  return { res, token: sent.tokens[sent.tokens.length - 1] };
};

describe('window', () => {
  it('shows an open window without the internal target', async () => {
    await openWindow({ target_size: 40 });
    const res = await request(app).get('/api/v1/applications/window');
    expect(res.body.state).toBe('open');
    expect(res.body.window.target_size).toBeUndefined();
  });
  it('shows when the next one opens while closed', async () => {
    await openWindow({ opens_at: new Date(Date.now() + 3 * DAY), closes_at: new Date(Date.now() + 8 * DAY), decisions_publish_at: new Date(Date.now() + 12 * DAY) });
    const res = await request(app).get('/api/v1/applications/window');
    expect(res.body.state).toBe('closed');
    expect(res.body.next_opens_at).toBeTruthy();
  });
});

describe('starting', () => {
  it('turns away under-13s and stores nothing', async () => {
    await openWindow();
    const { res } = await start({ birth_date: new Date(Date.now() - 12 * 365 * DAY).toISOString().slice(0, 10) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UNDER_AGE');
    expect(await prisma.application.count()).toBe(0);
    expect(sent.tokens).toHaveLength(0);
  });
  it('refuses when no window is open', async () => {
    const { res } = await start();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPLICATIONS_CLOSED');
  });
  it('gives the same answer for existing members and for repeat starts', async () => {
    await openWindow();
    await makeUser({ email: 'member@example.com' });
    const a = await start();
    const b = await start();
    const c = await start({ email: 'member@example.com' });
    expect(a.res.body).toEqual(b.res.body);
    expect(a.res.body).toEqual(c.res.body);
    expect(c.res.status).toBe(202);
    expect(await prisma.application.count()).toBe(1);
    expect(sent.tokens).toHaveLength(2); // none for the member
  });
});

describe('the applicant journey', () => {
  it('resumes, edits, submits once, and keeps results private', async () => {
    await openWindow();
    const { token } = await start();
    const me = await request(app).get('/api/v1/applications/me').set(bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.status).toBe('draft');

    expect((await request(app).post('/api/v1/applications/submit').set(bearer(token))).body.code).toBe('INCOMPLETE');
    const edit = await request(app).patch('/api/v1/applications/draft').set(bearer(token)).send({ interests: ['ai', 'design'] });
    expect(edit.status).toBe(200);

    expect((await request(app).post('/api/v1/applications/submit').set(bearer(token))).body.code).toBe('INTERVIEW_INCOMPLETE');
    for (let i = 1; i <= 10; i++) {
      const q = await request(app).post('/api/v1/applications/interview/next').set(bearer(token));
      await request(app).put(`/api/v1/applications/interview/answers/${q.body.next.position}`).set(bearer(token)).send(answerFor(q.body.next, `Answer number ${i}`));
    }
    const sub = await request(app).post('/api/v1/applications/submit').set(bearer(token));
    expect(sub.status).toBe(200);
    expect(sub.body.status).toBe('submitted');
    expect(sent.received[0]).toMatch(/^TX-\d{4}-\d{5}$/);
    expect((await request(app).post('/api/v1/applications/submit').set(bearer(token))).body.code).toBe('ALREADY_SUBMITTED');

    // Decided but not yet released: the applicant still sees "under review".
    await prisma.application.updateMany({ data: { status: 'accepted' } });
    expect((await request(app).get('/api/v1/applications/me').set(bearer(token))).body.status).toBe('under_review');
  });

  it('locks editing once review starts', async () => {
    await openWindow();
    const { token } = await start();
    await prisma.application.updateMany({ data: { status: 'under_review', locked_at: new Date() } });
    const res = await request(app).patch('/api/v1/applications/draft').set(bearer(token)).send({ city: 'Abuja' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPLICATION_LOCKED');
  });

  it('refuses a submission after the deadline and carries the draft forward', async () => {
    const w = await openWindow();
    const { token } = await start();
    await request(app).patch('/api/v1/applications/draft').set(bearer(token)).send({ interests: ['ai'] });
    for (let i = 1; i <= 10; i++) {
      const q = await request(app).post('/api/v1/applications/interview/next').set(bearer(token));
      await request(app).put(`/api/v1/applications/interview/answers/${q.body.next.position}`).set(bearer(token)).send(answerFor(q.body.next, `Answer ${i}`));
    }
    await prisma.applicationWindow.update({ where: { id: w.id }, data: { closes_at: new Date(Date.now() - 1000) } });
    const late = await request(app).post('/api/v1/applications/submit').set(bearer(token));
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('APPLICATIONS_CLOSED');

    const next = await openWindow({ opens_at: new Date(Date.now() - 1000) });
    const me = await request(app).get('/api/v1/applications/me').set(bearer(token));
    expect(me.body.window.id).toBe(next.id);
    expect(me.body.interests).toEqual(['ai']);
  });

  it('rejects bad or expired links', async () => {
    await openWindow();
    const { token } = await start();
    expect((await request(app).get('/api/v1/applications/me').set(bearer('x'.repeat(64)))).status).toBe(401);
    await prisma.application.updateMany({ data: { resume_expires_at: new Date(Date.now() - 1000) } });
    expect((await request(app).get('/api/v1/applications/me').set(bearer(token))).body.code).toBe('LINK_EXPIRED');
  });

  it('withdraws and starts the retention clock', async () => {
    await openWindow();
    const { token } = await start();
    const res = await request(app).post('/api/v1/applications/withdraw').set(bearer(token));
    expect(res.body.status).toBe('withdrawn');
    expect((await prisma.application.findFirstOrThrow()).retention_delete_at).not.toBeNull();
  });
});

describe('cohort admin', () => {
  const dates = (o = 0) => ({
    opens_at: new Date(Date.now() + (10 + o) * DAY).toISOString(),
    closes_at: new Date(Date.now() + (20 + o) * DAY).toISOString(),
    decisions_publish_at: new Date(Date.now() + (30 + o) * DAY).toISOString(),
  });
  it('is admin-only', async () => {
    const mod = await makeUser({ role: 'moderator' });
    expect((await request(app).get('/api/v1/admin/cohorts').set(mod.auth)).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/cohorts').send(dates())).status).toBe(401);
  });
  it('creates, rejects overlaps and bad order, and audits', async () => {
    const admin = await makeUser({ role: 'admin' });
    const ok = await request(app).post('/api/v1/admin/cohorts').set(admin.auth).send({ ...dates(), target_size: 40 });
    expect(ok.status).toBe(201);
    expect(ok.body.state).toBe('upcoming');
    expect((await request(app).post('/api/v1/admin/cohorts').set(admin.auth).send(dates(2))).body.code).toBe('WINDOW_OVERLAP');
    const bad = { ...dates(100), decisions_publish_at: new Date(Date.now() + 100 * DAY).toISOString() };
    expect((await request(app).post('/api/v1/admin/cohorts').set(admin.auth).send(bad)).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: 'cohort.create' } })).toBe(1);
    const list = await request(app).get('/api/v1/admin/cohorts').set(admin.auth);
    expect(list.body.items).toHaveLength(1);
  });
});
