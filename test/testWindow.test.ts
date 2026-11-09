import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { runRetention } from '../src/jobs/retention.js';
import { checkInvitation } from '../src/lib/invitations.js';
import { baseEmail, testRecipientAllowed } from '../src/lib/testWindow.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

const sent = vi.hoisted(() => ({ links: [] as { token: string; test: boolean }[], accept: [] as { token: string; test: boolean }[], decline: [] as boolean[] }));
vi.mock('../src/lib/admissionsEmail.js', () => ({
  sendApplicationLink: async (_e: string, token: string, test = false) => { sent.links.push({ token, test }); },
  sendApplicationReceived: async () => {}, sendApplicationReminderOpen: async () => {},
  sendAcceptance: async (_e: string, token: string, _d: number, test = false) => { sent.accept.push({ token, test }); },
  sendDecline: async (_e: string, _f: string | null, test = false) => { sent.decline.push(test); },
  sendWaitlisted: async () => {}, sendGuardianRequest: async () => {}, sendClarificationRequest: async () => {},
}));

beforeEach(async () => { await resetDb(); sent.links.length = 0; sent.accept.length = 0; sent.decline.length = 0; });
afterAll(() => prisma.$disconnect());

const DAY = 86_400_000;
const realWindow = () => prisma.applicationWindow.create({ data: { opens_at: new Date(Date.now() - DAY), closes_at: new Date(Date.now() + 5 * DAY), decisions_publish_at: new Date(Date.now() + 10 * DAY), form_version: 'v1' } });
const form = (over: Record<string, unknown> = {}) => ({
  email: 'ada@example.com', full_name: 'Ada Obi', birth_date: '2010-05-01', country: 'Nigeria', city: 'Lagos', whatsapp: '+234 800 000 0000', education_level: 'secondary', ...over,
});
const makeTest = async (admin: { auth: Record<string, string> }) => (await request(app).post('/api/v1/admin/cohorts/test').set(admin.auth).send({})).body as { id: string; test_key: string; is_test: boolean };

describe('creating a test window', () => {
  it('is admin-only, open now, and has a private key', async () => {
    const mod = await makeUser({ role: 'moderator' });
    expect((await request(app).post('/api/v1/admin/cohorts/test').set(mod.auth).send({})).status).toBe(403);
    const admin = await makeUser({ role: 'admin' });
    const t = await makeTest(admin);
    expect(t.is_test).toBe(true);
    expect(t.test_key).toMatch(/^[0-9a-f]{36}$/);
  });
  it('never clashes with a real window', async () => {
    await realWindow();
    const admin = await makeUser({ role: 'admin' });
    expect((await request(app).post('/api/v1/admin/cohorts/test').set(admin.auth).send({})).status).toBe(201);
  });
});

describe('keeping a test window out of the real thing', () => {
  it('is invisible to the public without its key, and the real window still wins', async () => {
    const admin = await makeUser({ role: 'admin' });
    const t = await makeTest(admin);
    expect((await request(app).get('/api/v1/applications/window')).body.state).toBe('closed');
    const real = await realWindow();
    const pub = await request(app).get('/api/v1/applications/window');
    expect(pub.body.window.id).toBe(real.id);
    expect(pub.body.window.is_test).toBe(false);
    const viaKey = await request(app).get(`/api/v1/applications/window?test_key=${t.test_key}`);
    expect(viaKey.body.window.id).toBe(t.id);
    expect(viaKey.body.window.is_test).toBe(true);
    expect((await request(app).get('/api/v1/applications/window?test_key=nope')).body.state).toBe('closed');
  });

  it('only accepts team email addresses, so no outsider can be emailed', async () => {
    const admin = await makeUser({ role: 'admin', email: 'boss@example.com' });
    const t = await makeTest(admin);
    const outsider = await request(app).post('/api/v1/applications/start').send(form({ test_key: t.test_key }));
    expect(outsider.status).toBe(422);
    expect(outsider.body.code).toBe('TEST_EMAIL_NOT_ALLOWED');
    expect(await prisma.application.count()).toBe(0);
    expect(sent.links).toHaveLength(0);

    const ok = await request(app).post('/api/v1/applications/start').send(form({ test_key: t.test_key, email: 'boss+kid1@example.com' }));
    expect(ok.status).toBe(202);
    expect(sent.links[0]!.test).toBe(true);
    const row = await prisma.application.findFirstOrThrow();
    expect(row.reference).toMatch(/^TEST-/);
    expect(row.window_id).toBe(t.id);
  });

  it('a wrong key cannot fall back to the real window', async () => {
    await realWindow();
    const res = await request(app).post('/api/v1/applications/start').send(form({ test_key: 'x'.repeat(20) }));
    expect(res.status).toBe(409);
    expect(await prisma.application.count()).toBe(0);
  });

  it('keeps test applications out of the real queue and stats unless asked', async () => {
    const admin = await makeUser({ role: 'admin', email: 'boss@example.com' });
    const t = await makeTest(admin);
    await request(app).post('/api/v1/applications/start').send(form({ test_key: t.test_key, email: 'boss+a@example.com' }));
    await prisma.application.updateMany({ data: { status: 'submitted', submitted_at: new Date() } });
    const list = (q = '') => request(app).get(`/api/v1/admin/applications${q}`).set(admin.auth);
    expect((await list()).body.total).toBe(0);
    expect((await list('?include_test=1')).body.total).toBe(1);
    expect((await list(`?window_id=${t.id}`)).body.total).toBe(1);
    const stats = await request(app).get('/api/v1/admin/applications/stats').set(admin.auth);
    expect(stats.body.unclaimed).toBe(0);
  });

  it('does not move drafts between a real and a test window', async () => {
    const admin = await makeUser({ role: 'admin', email: 'boss@example.com' });
    const t = await makeTest(admin);
    await request(app).post('/api/v1/applications/start').send(form({ test_key: t.test_key, email: 'boss+a@example.com' }));
    const real = await realWindow();
    // A real person starting now must not pick up the rehearsal draft, and the rehearsal draft must stay put.
    await request(app).post('/api/v1/applications/start').send(form({ email: 'boss+a@example.com' }));
    const rows = await prisma.application.findMany({ orderBy: { created_at: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.window_id).toBe(t.id);
    expect(rows[1]!.window_id).toBe(real.id);
    expect(rows[1]!.reference).toMatch(/^TX-/);
  });

  it('team addresses count with or without a +tag, and nobody else does', async () => {
    await makeUser({ role: 'admin', email: 'Boss@Example.com' });
    await makeUser({ role: 'member', email: 'kid@example.com' });
    expect(baseEmail('Boss+x@Example.com')).toBe('boss@example.com');
    expect(await testRecipientAllowed('boss+test@example.com')).toBe(true);
    expect(await testRecipientAllowed('boss@example.com')).toBe(true);
    expect(await testRecipientAllowed('kid@example.com')).toBe(false);
    expect(await testRecipientAllowed('stranger@example.com')).toBe(false);
  });
});

describe('releasing and purging a test window', () => {
  const setup = async () => {
    const admin = await makeUser({ role: 'admin', email: 'boss@example.com' });
    const t = await makeTest(admin);
    await request(app).post('/api/v1/applications/start').send(form({ test_key: t.test_key, email: 'boss+a@example.com' }));
    const a = await prisma.application.findFirstOrThrow();
    await prisma.application.update({ where: { id: a.id }, data: { status: 'accepted', submitted_at: new Date(), decided_at: new Date() } });
    return { admin, t, a };
  };

  it('releases at once, flags the email as a test, and the invitation can never open an account', async () => {
    const { admin, t, a } = await setup();
    const res = await request(app).post(`/api/v1/admin/cohorts/${t.id}/release`).set(admin.auth).send({});
    expect(res.status).toBe(200);
    expect(sent.accept).toHaveLength(1);
    expect(sent.accept[0]!.test).toBe(true);
    const check = await checkInvitation(sent.accept[0]!.token, a.email);
    expect(check.problem).toBe('INVITE_TEST');
  });

  it('purges the window and every record in it, and refuses to touch a real window', async () => {
    const { admin, t } = await setup();
    const real = await realWindow();
    expect((await request(app).delete(`/api/v1/admin/cohorts/${real.id}`).set(admin.auth)).body.code).toBe('NOT_TEST');
    const del = await request(app).delete(`/api/v1/admin/cohorts/${t.id}`).set(admin.auth);
    expect(del.body.purged).toBe(1);
    expect(await prisma.application.count()).toBe(0);
    expect(await prisma.applicationWindow.count({ where: { id: t.id } })).toBe(0);
    expect(await prisma.applicationWindow.count({ where: { id: real.id } })).toBe(1);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'application.purge' } });
    expect(JSON.stringify(log.meta)).toContain(t.id);
  });

  it('retention clears a test window two weeks after it closes', async () => {
    const { t } = await setup();
    await prisma.applicationWindow.update({ where: { id: t.id }, data: { closes_at: new Date(Date.now() - 15 * DAY) } });
    expect((await runRetention()).test_windows).toBe(1);
    expect(await prisma.applicationWindow.count()).toBe(0);
  });
});

describe('window history', () => {
  it('is admin-only and needs both admissions permissions', async () => {
    const mod = await makeUser({ role: 'moderator' });
    expect((await request(app).get('/api/v1/admin/admissions-history').set(mod.auth)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/admissions-history')).status).toBe(401);
  });

  it('lists real windows by default with counts and outcomes, and test windows only when asked', async () => {
    const admin = await makeUser({ role: 'admin', email: 'boss@example.com' });
    const real = await realWindow();
    const mk = (n: number, status: string, over: Record<string, unknown> = {}) => prisma.application.create({ data: {
      reference: `TX-2026-0000${n}`, window_id: real.id, status: status as 'accepted', submitted_at: status === 'draft' ? null : new Date(), email: `a${n}@example.com`, full_name: `Applicant ${n}`,
      birth_date: new Date('2010-01-01'), country: 'NG', city: 'Lagos', whatsapp: '+2340000000', education_level: 'secondary', interests: [], current_skills: [], learning_goals: [], ...over } });
    await mk(1, 'accepted', { published_at: new Date() });
    await mk(2, 'declined', { retention_delete_at: new Date(Date.now() + DAY) });
    await mk(3, 'submitted');
    await mk(4, 'draft');
    await makeTest(admin);

    const res = await request(app).get('/api/v1/admin/admissions-history').set(admin.auth);
    expect(res.body.items).toHaveLength(1);
    const w = res.body.items[0];
    expect(w).toMatchObject({ started: 4, submitted: 3, drafts: 1, accepted: 1, declined: 1, undecided: 1, results_released: 1, joined: 0 });
    expect((await request(app).get('/api/v1/admin/admissions-history?include_test=1').set(admin.auth)).body.items).toHaveLength(2);

    const rows = await request(app).get(`/api/v1/admin/admissions-history/${real.id}/applicants`).set(admin.auth);
    expect(rows.body.total).toBe(3);
    expect(rows.body.drafts).toBe(1);
    const first = rows.body.items[0];
    expect(first.email).toBeUndefined();
    expect(first.whatsapp).toBeUndefined();
    expect(rows.body.items.find((r: { status: string }) => r.status === 'declined').delete_on).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { action: 'application.history_view' } })).toBe(1);
  });

  it('counts records already deleted by retention', async () => {
    const admin = await makeUser({ role: 'admin' });
    const real = await realWindow();
    await prisma.application.create({ data: {
      reference: 'TX-2026-00001', window_id: real.id, status: 'declined', email: 'a@example.com', full_name: 'A', birth_date: new Date('2010-01-01'), country: 'NG', city: 'L', whatsapp: '+2340000000',
      education_level: 'secondary', interests: [], current_skills: [], learning_goals: [], retention_delete_at: new Date(Date.now() - 1000) } });
    await runRetention();
    const res = await request(app).get('/api/v1/admin/admissions-history').set(admin.auth);
    expect(res.body.items[0].deleted).toBe(1);
    expect(res.body.items[0].started).toBe(0);
  });
});
