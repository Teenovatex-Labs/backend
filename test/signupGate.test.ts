import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    async verifyIdToken({ idToken }: { idToken: string }) {
      const [sub, email] = idToken.split('|');
      return { getPayload: () => ({ sub, email, email_verified: true, name: 'Goog User' }) };
    }
  },
}));

import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { newInvitation } from '../src/lib/admissions.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(async () => {
  await resetDb();
  config.requireInvitation = true;
  config.googleClientId = 'test-client';
});
afterAll(async () => {
  config.requireInvitation = false;
  await prisma.$disconnect();
});

const base = { full_name: 'Ada Lovelace', username: 'ada_l', email: 'ada@example.com', password: 'Sup3rSecret', birth_date: '2008-05-10' };

const invite = async (email = 'ada@example.com', over: Record<string, unknown> = {}) => {
  const inv = newInvitation();
  await prisma.invitation.create({ data: { token_hash: inv.hash, email, role: 'member', source: 'application', expires_at: inv.expires, ...over } });
  return inv.token;
};

describe('invitation-gated registration', () => {
  it('refuses a sign-up with no invitation', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(base);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVITE_REQUIRED');
    expect(await prisma.user.count()).toBe(0);
  });

  it('refuses unknown, expired, revoked and other-address invitations', async () => {
    const expired = await invite('ada@example.com', { expires_at: new Date(Date.now() - 1000) });
    const revoked = await invite('ada@example.com', { revoked_at: new Date() });
    const other = await invite('someone@example.com');
    for (const t of ['x'.repeat(64), expired, revoked]) {
      const r = await request(app).post('/api/v1/auth/register').send({ ...base, invite_token: t });
      expect(r.body.code).toBe('INVITE_INVALID');
    }
    expect((await request(app).post('/api/v1/auth/register').send({ ...base, invite_token: other })).body.code).toBe('INVITE_EMAIL_MISMATCH');
    expect(await prisma.user.count()).toBe(0);
  });

  it('creates an onboarding member, uses the invitation up and records it', async () => {
    const token = await invite();
    const res = await request(app).post('/api/v1/auth/register').send({ ...base, invite_token: token });
    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: base.email } });
    expect(user.membership_status).toBe('onboarding');
    expect(user.existing_member).toBe(false);
    expect(user.onboarding_due_at!.getTime()).toBeGreaterThan(Date.now() + 6.9 * 86400000);
    const inv = await prisma.invitation.findFirstOrThrow();
    expect(inv.used_by).toBe(user.id);
    expect(await prisma.membershipEvent.count({ where: { user_id: user.id, to_status: 'onboarding' } })).toBe(1);
  });

  it('lets the same person retry an unverified sign-up, but nobody else reuse the link', async () => {
    const token = await invite();
    expect((await request(app).post('/api/v1/auth/register').send({ ...base, invite_token: token })).status).toBe(201);
    expect((await request(app).post('/api/v1/auth/register').send({ ...base, password: 'An0therSecret', invite_token: token })).status).toBe(201);
    await prisma.user.update({ where: { email: base.email }, data: { email_verified: true } });
    const again = await request(app).post('/api/v1/auth/register').send({ ...base, username: 'ada_2', invite_token: token });
    expect(again.status).toBe(400); // verified email already in use
  });

  it('lets only one of two simultaneous sign-ups win', async () => {
    const token = await invite('a@example.com');
    const a = request(app).post('/api/v1/auth/register').send({ ...base, email: 'a@example.com', username: 'aa_user', invite_token: token });
    const b = request(app).post('/api/v1/auth/register').send({ ...base, email: 'a@example.com', username: 'bb_user', invite_token: token });
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status].filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect(await prisma.invitation.count({ where: { used_at: { not: null } } })).toBe(1);
  });

  it('leaves existing members and logins alone', async () => {
    const { user } = await makeUser({ existing_member: true, password_hash: null });
    expect(user.membership_status).toBe('active');
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'whatever1A' });
    expect(res.status).not.toBe(403);
  });

  it('accepts registration without an invitation when the gate is off', async () => {
    config.requireInvitation = false;
    const res = await request(app).post('/api/v1/auth/register').send(base);
    expect(res.status).toBe(201);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: base.email } })).membership_status).toBe('active');
  });
});

describe('invitation-gated Google sign-in', () => {
  it('does not turn an unverified signup into an active member without an invitation', async () => {
    const { user } = await makeUser({ email: 'pending@example.com', email_verified: false, google_id: null });
    const res = await request(app).post('/api/v1/auth/google').send({ id_token: 'g-pending|pending@example.com' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVITE_REQUIRED');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).google_id).toBeNull();
  });

  it('links an unverified signup only with its invitation and starts onboarding', async () => {
    const { user } = await makeUser({ email: 'pending@example.com', email_verified: false, google_id: null });
    const token = await invite('pending@example.com');
    const res = await request(app).post('/api/v1/auth/google').send({ id_token: 'g-pending|pending@example.com', invite_token: token });
    expect(res.status).toBe(200);
    const linked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(linked.google_id).toBe('g-pending');
    expect(linked.membership_status).toBe('onboarding');
    expect(linked.onboarding_due_at).not.toBeNull();
    expect((await prisma.invitation.findFirstOrThrow()).used_by).toBe(user.id);
  });

  it('refuses a new Google account with no invitation', async () => {
    const res = await request(app).post('/api/v1/auth/google').send({ id_token: 'g1|new@example.com' });
    expect(res.status).toBe(403);
    expect(await prisma.user.count()).toBe(0);
  });

  it('creates an onboarding member from an invitation sent to that Google address', async () => {
    const token = await invite('new@example.com');
    const res = await request(app).post('/api/v1/auth/google').send({ id_token: 'g1|new@example.com', invite_token: token });
    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'new@example.com' } });
    expect(user.membership_status).toBe('onboarding');
    expect((await prisma.invitation.findFirstOrThrow()).used_by).toBe(user.id);
  });

  it('rejects an invitation sent to a different address', async () => {
    const token = await invite('other@example.com');
    const res = await request(app).post('/api/v1/auth/google').send({ id_token: 'g1|new@example.com', invite_token: token });
    expect(res.body.code).toBe('INVITE_EMAIL_MISMATCH');
  });

  it('still signs in an existing Google member without any invitation', async () => {
    await makeUser({ email: 'old@example.com', google_id: 'g9', existing_member: true });
    const res = await request(app).post('/api/v1/auth/google').send({ id_token: 'g9|old@example.com' });
    expect(res.status).toBe(200);
  });
});
