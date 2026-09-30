import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { hashVerificationCode } from '../src/lib/verification.js';
import { resetDb } from './helpers.js';

beforeEach(async () => {
  await resetDb();
  config.adminEmails = ['boss@example.com'];
});
afterAll(() => prisma.$disconnect());

const signUp = (email: string) =>
  request(app).post('/api/v1/auth/register').send({ full_name: 'Some One', username: `u_${Math.random().toString(36).slice(2, 8)}`, email, password: 'Sup3rSecret', birth_date: '2008-05-10' });

const verify = async (email: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  await prisma.user.update({ where: { id: user.id }, data: { verification_code_hash: hashVerificationCode('123456', user.id), verification_code_expires_at: new Date(Date.now() + 600000), verification_attempts: 0 } });
  return request(app).post('/api/v1/auth/verify-email').send({ email, code: '123456' });
};

describe('ADMIN_EMAILS', () => {
  it('makes the listed address an admin only after it is verified', async () => {
    await signUp('boss@example.com');
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'boss@example.com' } })).role).toBe('member'); // typing it is not enough

    expect((await verify('boss@example.com')).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'boss@example.com' } })).role).toBe('admin');
    expect(await prisma.auditLog.count({ where: { action: 'user.role' } })).toBe(1);
  });

  it('matches the address without caring about capital letters, and leaves everyone else alone', async () => {
    config.adminEmails = ['boss@example.com'];
    await signUp('Boss@Example.com');
    await verify('Boss@Example.com');
    expect((await prisma.user.findFirstOrThrow({ where: { email: { equals: 'boss@example.com', mode: 'insensitive' } } })).role).toBe('admin');

    await signUp('other@example.com');
    await verify('other@example.com');
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'other@example.com' } })).role).toBe('member');
  });

  it('does nothing when the list is empty', async () => {
    config.adminEmails = [];
    await signUp('boss@example.com');
    await verify('boss@example.com');
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'boss@example.com' } })).role).toBe('member');
  });
});
