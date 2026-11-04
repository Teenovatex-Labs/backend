import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const A = '/api/v1/admin';
const DAY = 86_400_000;
const status = (admin: { auth: object }, id: string, to: string, reason = 'Agreed with the member') =>
  request(app).post(`${A}/members/${id}/status`).set(admin.auth as Record<string, string>).send({ status: to, reason });

describe('status changes', () => {
  it('follows the allowed transitions, records an event and an audit line, and tells the member', async () => {
    const admin = await makeUser({ role: 'admin' });
    const m = await makeUser();
    expect((await status(admin, m.user.id, 'on_leave')).status).toBe(200);
    expect((await status(admin, m.user.id, 'onboarding')).body.code).toBe('BAD_TRANSITION');
    expect(await prisma.membershipEvent.count({ where: { user_id: m.user.id, to_status: 'on_leave' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'membership.status' } })).toBe(1);
    expect(await prisma.notification.count({ where: { user_id: m.user.id, type: 'membership' } })).toBe(1);
  });
  it('is admin-only and never lets you change yourself', async () => {
    const admin = await makeUser({ role: 'admin' });
    const mod = await makeUser({ role: 'moderator' });
    const m = await makeUser();
    expect((await status(mod, m.user.id, 'alumni')).status).toBe(403);
    expect((await status(admin, admin.user.id, 'on_leave')).body.code).toBe('SELF_CHANGE');
  });
});

describe('removal', () => {
  it('signs the member out everywhere and blocks login', async () => {
    const admin = await makeUser({ role: 'admin' });
    const m = await makeUser({ email: 'gone@example.com', password_hash: await bcrypt.hash('Password123!', 4) });
    await prisma.session.create({ data: { user_id: m.user.id, token_hash: 'h'.repeat(64) } });
    expect((await status(admin, m.user.id, 'removed')).status).toBe(200);
    expect(await prisma.session.count({ where: { user_id: m.user.id } })).toBe(0);
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'gone@example.com', password: 'Password123!' });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('ACCOUNT_REMOVED');
    expect((await status(admin, m.user.id, 'active')).body.code).toBe('BAD_TRANSITION');
  });
});

describe('inactivity review', () => {
  it('lists candidates only, and changes nothing by itself', async () => {
    const admin = await makeUser({ role: 'admin' });
    const quiet = await makeUser({ last_login_at: new Date(Date.now() - 90 * DAY) });
    await makeUser({ last_login_at: new Date() });
    const res = await request(app).get(`${A}/members/inactivity?days=60`).set(admin.auth);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([quiet.user.id]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: quiet.user.id } })).membership_status).toBe('active');
  });

  it('runs start, member response, decision, and blocks direct changes while open', async () => {
    const admin = await makeUser({ role: 'admin' });
    const m = await makeUser();
    const start = await request(app).post(`${A}/members/${m.user.id}/inactivity-review`).set(admin.auth).send({ reason: 'No activity for ten weeks', days: 10 });
    expect(start.status).toBe(201);
    expect((await request(app).post(`${A}/members/${m.user.id}/inactivity-review`).set(admin.auth).send({ reason: 'Again please' })).body.code).toBe('REVIEW_OPEN');
    expect((await status(admin, m.user.id, 'removed', 'Removing without waiting for the review')).body.code).toBe('REVIEW_OPEN');

    expect((await request(app).get('/api/v1/membership/review').set(m.auth)).body.review.responded).toBe(false);
    await request(app).post('/api/v1/membership/review/respond').set(m.auth).send({ message: 'I was busy with exams, I am back now.' });
    const open = await request(app).get(`${A}/inactivity-reviews`).set(admin.auth);
    expect(open.body.items[0].member_response).toMatch(/exams/);

    const short = await request(app).post(`${A}/members/${m.user.id}/inactivity-review/decide`).set(admin.auth).send({ decision: 'removed', reason: 'too short' });
    expect(short.body.code).toBe('REASON_REQUIRED');
    const stay = await request(app).post(`${A}/members/${m.user.id}/inactivity-review/decide`).set(admin.auth).send({ decision: 'active', reason: 'They replied and are back' });
    expect(stay.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: m.user.id } })).membership_status).toBe('active');
    expect((await request(app).post(`${A}/members/${m.user.id}/inactivity-review/decide`).set(admin.auth).send({ decision: 'alumni', reason: 'Second decision attempt' })).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: 'membership.review' } } })).toBeGreaterThanOrEqual(3);
  });

  it('an overdue review is flagged but never acts on its own', async () => {
    const admin = await makeUser({ role: 'admin' });
    const m = await makeUser();
    await request(app).post(`${A}/members/${m.user.id}/inactivity-review`).set(admin.auth).send({ reason: 'No activity for ten weeks' });
    await prisma.inactivityReview.updateMany({ data: { response_due_at: new Date(Date.now() - DAY) } });
    const open = await request(app).get(`${A}/inactivity-reviews`).set(admin.auth);
    expect(open.body.items[0].overdue).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: m.user.id } })).membership_status).toBe('active');
  });
});
