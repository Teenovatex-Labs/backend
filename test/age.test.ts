import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { ageOn, isValidBirthDate } from '../src/lib/age.js';
import { generateAccessToken } from '../src/lib/tokens.js';
import { requireAuth, requireRole } from '../src/middleware/auth.js';
import { resetDb } from './helpers.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** A birth date exactly `years` ago today, shifted by `days` (positive = born later). */
const born = (years: number, days = 0) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

const signup = (birth_date: string | undefined, extra: Record<string, unknown> = {}) => ({
  full_name: 'Tayo Bello',
  username: `tayo_${Math.random().toString(36).slice(2, 8)}`,
  email: `tayo_${Math.random().toString(36).slice(2, 8)}@example.com`,
  password: 'Sup3rSecret',
  ...(birth_date !== undefined && { birth_date }),
  ...extra,
});

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('age helpers', () => {
  it('counts a birthday exactly on the day, not the day before', () => {
    expect(ageOn(born(13))).toBe(13);
    expect(ageOn(born(13, 1))).toBe(12);
    expect(ageOn(born(13, -1))).toBe(13);
  });

  it('rejects impossible, future and ancient dates', () => {
    expect(isValidBirthDate('2011-02-30')).toBe(false);
    expect(isValidBirthDate('not-a-date')).toBe(false);
    expect(isValidBirthDate('1899-12-31')).toBe(false);
    expect(isValidBirthDate(born(-1))).toBe(false);
    expect(isValidBirthDate('2008-05-10')).toBe(true);
  });
});

describe('sign-up age gate', () => {
  it('lets a 13-year-old in, records the birth date and time zone', async () => {
    const body = signup(born(13), { timezone: 'Africa/Lagos' });
    const res = await request(app).post('/api/v1/auth/register').send(body);
    expect(res.status).toBe(201);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    expect(user?.birth_date?.toISOString().slice(0, 10)).toBe(born(13));
    expect(user?.timezone).toBe('Africa/Lagos');
  });

  it('turns away someone one day short of 13 and stores nothing', async () => {
    const body = signup(born(13, 1));
    const res = await request(app).post('/api/v1/auth/register').send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AGE_TOO_YOUNG');
    expect(await prisma.user.count()).toBe(0);
  });

  it('requires a birth date and rejects future dates and unknown time zones', async () => {
    expect((await request(app).post('/api/v1/auth/register').send(signup(undefined))).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/register').send(signup(born(-1)))).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/register').send(signup(born(15), { timezone: 'Mars/Base' }))).status).toBe(400);
  });
});

const makeMember = async (birth_date: string | null = null, role: 'member' | 'admin' = 'member') => {
  const tag = Math.random().toString(36).slice(2, 8);
  const user = await prisma.user.create({
    data: {
      email: `m_${tag}@example.com`,
      username: `m_${tag}`,
      full_name: 'Existing Member',
      email_verified: true,
      role,
      ...(birth_date && { birth_date: new Date(`${birth_date}T00:00:00.000Z`) }),
    },
  });
  return { user, auth: { Authorization: `Bearer ${generateAccessToken(user.id)}` } };
};

describe('confirming age for existing members', () => {
  it('reports age_confirmed false until the date is set, then true', async () => {
    const { auth } = await makeMember();
    expect((await request(app).get('/api/v1/users/me').set(auth)).body.age_confirmed).toBe(false);

    const set = await request(app).post('/api/v1/users/me/birth-date').set(auth).send({ birth_date: born(16) });
    expect(set.status).toBe(200);

    const me = await request(app).get('/api/v1/users/me').set(auth);
    expect(me.body.age_confirmed).toBe(true);
    expect(me.body.birth_date).toBe(born(16));
  });

  it('will not change a date that is already set', async () => {
    const { auth } = await makeMember(born(16));
    const again = await request(app).post('/api/v1/users/me/birth-date').set(auth).send({ birth_date: born(20) });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_SET');
  });

  it('removes the account of anyone under 13', async () => {
    const { user, auth } = await makeMember();
    const res = await request(app).post('/api/v1/users/me/birth-date').set(auth).send({ birth_date: born(11) });
    expect(res.status).toBe(403);
    expect(res.body.account_removed).toBe(true);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it('blocks posting and voting until age is confirmed', async () => {
    const { auth } = await makeMember();
    const create = await request(app).post('/api/v1/projects').set(auth).field('name', 'My Lab');
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('AGE_REQUIRED');

    const vote = await request(app).post('/api/v1/projects/anything/vote').set(auth);
    expect(vote.status).toBe(403);
    expect(vote.body.code).toBe('AGE_REQUIRED');
  });

  it('never shows a birth date on a public profile', async () => {
    const { user } = await makeMember(born(16));
    const res = await request(app).get(`/api/v1/users/${user.username}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(born(16));
    expect(res.body.birth_date).toBeUndefined();
  });
});

describe('roles', () => {
  const guarded = () => {
    const a = express();
    a.get('/admin-only', requireAuth, requireRole('admin', 'moderator'), (_req, res) => res.json({ ok: true }));
    return a;
  };

  it('keeps ordinary members out and lets admins in', async () => {
    const member = await makeMember(born(16), 'member');
    const admin = await makeMember(born(30), 'admin');
    expect((await request(guarded()).get('/admin-only').set(member.auth)).status).toBe(403);
    expect((await request(guarded()).get('/admin-only').set(admin.auth)).status).toBe(200);
    expect((await request(guarded()).get('/admin-only')).status).toBe(401);
  });
});
