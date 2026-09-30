import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { resetDb } from './helpers.js';

// With no email provider configured the server logs each code instead of sending it,
// which is how the tests read them.
const codes: string[] = [];
beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    const m = String(args[0]).match(/\[DEV\] (?:Verification|Password reset) code for .*?: (\d{6})/);
    if (m) codes.push(m[1]);
  });
});
afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.$disconnect();
});
beforeEach(async () => {
  codes.length = 0;
  await resetDb();
});

const signup = {
  full_name: 'Ada Lovelace',
  username: 'ada_l',
  email: 'ada@example.com',
  password: 'Sup3rSecret',
};

describe('sign-up, verification and login', () => {
  it('registers, blocks login until verified, then verifies and signs in', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send(signup);
    expect(reg.status).toBe(201);
    expect(reg.body.require_verification).toBe(true);
    expect(codes).toHaveLength(1);

    const early = await request(app).post('/api/v1/auth/login').send({ email: signup.email, password: signup.password });
    expect(early.status).toBe(403);
    expect(early.body.code).toBe('EMAIL_NOT_VERIFIED');

    const wrong = await request(app).post('/api/v1/auth/verify-email').send({ email: signup.email, code: '000000' });
    expect(wrong.status).toBe(400);

    const ok = await request(app).post('/api/v1/auth/verify-email').send({ email: signup.email, code: codes[0] });
    expect(ok.status).toBe(200);
    expect(ok.body.access_token).toBeTruthy();
    expect(ok.body.refresh_token).toBeTruthy();

    const login = await request(app).post('/api/v1/auth/login').send({ email: signup.email, password: signup.password });
    expect(login.status).toBe(200);

    const me = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${login.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('ada_l');
    expect(me.body.email).toBe('ada@example.com');
    expect(me.body.password_hash).toBeUndefined();
  });

  it('rejects a wrong password with the same error as an unknown email', async () => {
    await request(app).post('/api/v1/auth/register').send(signup);
    await request(app).post('/api/v1/auth/verify-email').send({ email: signup.email, code: codes[0] });

    const badPassword = await request(app).post('/api/v1/auth/login').send({ email: signup.email, password: 'Nope1234' });
    const noUser = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@example.com', password: 'Nope1234' });
    expect(badPassword.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(badPassword.body.code).toBe(noUser.body.code);
  });

  it('refuses weak passwords and duplicate usernames', async () => {
    const weak = await request(app).post('/api/v1/auth/register').send({ ...signup, password: 'short' });
    expect(weak.status).toBe(400);

    await request(app).post('/api/v1/auth/register').send(signup);
    await request(app).post('/api/v1/auth/verify-email').send({ email: signup.email, code: codes[0] });
    const dup = await request(app).post('/api/v1/auth/register').send({ ...signup, email: 'other@example.com' });
    expect(dup.status).toBeGreaterThanOrEqual(400);
  });

  it('protects private routes and rejects tampered tokens', async () => {
    expect((await request(app).get('/api/v1/users/me')).status).toBe(401);
    const bad = await request(app).get('/api/v1/users/me').set('Authorization', 'Bearer not.a.token');
    expect(bad.status).toBe(401);
  });
});

describe('password reset', () => {
  it('resets a password with a code, then the new password works and the old one does not', async () => {
    await request(app).post('/api/v1/auth/register').send(signup);
    await request(app).post('/api/v1/auth/verify-email').send({ email: signup.email, code: codes[0] });
    codes.length = 0;

    await request(app).post('/api/v1/auth/forgot-password').send({ email: signup.email });
    expect(codes).toHaveLength(1);

    const verified = await request(app).post('/api/v1/auth/verify-reset-code').send({ email: signup.email, code: codes[0] });
    expect(verified.status).toBe(200);

    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: verified.body.token, new_password: 'Brand1NewPass' });
    expect(reset.status).toBe(200);

    const oldPw = await request(app).post('/api/v1/auth/login').send({ email: signup.email, password: signup.password });
    expect(oldPw.status).toBe(401);
    const newPw = await request(app).post('/api/v1/auth/login').send({ email: signup.email, password: 'Brand1NewPass' });
    expect(newPw.status).toBe(200);
  });

  it('will not accept an access token as a reset token', async () => {
    await request(app).post('/api/v1/auth/register').send(signup);
    const v = await request(app).post('/api/v1/auth/verify-email').send({ email: signup.email, code: codes[0] });
    const res = await request(app).post('/api/v1/auth/reset-password').send({ token: v.body.access_token, new_password: 'Brand1NewPass' });
    expect(res.status).toBe(400);
  });
});
