import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { REFRESH_GRACE_MS } from '../src/controllers/auth.js';
import { createSession } from '../src/lib/tokens.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const refresh = (refresh_token: string) => request(app).post('/api/v1/auth/refresh').send({ refresh_token });
const start = async () => {
  const { user } = await makeUser();
  const tokens = await createSession(user.id, { headers: {}, ip: '127.0.0.1' } as never);
  return { user, ...tokens };
};

describe('refresh token rotation', () => {
  it('hands out a new refresh token each time, and the old one stops being the current one', async () => {
    const { refresh_token: first } = await start();
    const a = await refresh(first);
    expect(a.status).toBe(200);
    expect(a.body.access_token).toBeTruthy();
    expect(a.body.refresh_token).toBeTruthy();
    expect(a.body.refresh_token).not.toBe(first);

    const b = await refresh(a.body.refresh_token); // the new one works, and rotates again
    expect(b.status).toBe(200);
    expect(b.body.refresh_token).not.toBe(a.body.refresh_token);
    expect(await prisma.session.count()).toBe(1); // still one session, not one per refresh
  });

  it('gives a second tab a working access token when it refreshes with the just-replaced token', async () => {
    const { refresh_token: first } = await start();
    await refresh(first);
    const late = await refresh(first); // same token again, moments later
    expect(late.status).toBe(200);
    expect(late.body.access_token).toBeTruthy();
    expect(late.body.refresh_token).toBeUndefined(); // no second rotation: the other tab holds the new one
  });

  it('lets only one of several simultaneous refreshes rotate', async () => {
    const { refresh_token } = await start();
    const results = await Promise.all([1, 2, 3, 4].map(() => refresh(refresh_token)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.refresh_token)).toHaveLength(1);
  });

  it('ends the session when an old token is replayed after the grace window', async () => {
    const { refresh_token: first, user } = await start();
    const rotated = await refresh(first);
    await prisma.session.updateMany({ where: { user_id: user.id }, data: { rotated_at: new Date(Date.now() - REFRESH_GRACE_MS - 5_000) } });

    const replay = await refresh(first);
    expect(replay.status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
    // The thief's copy is dead, and so is the real owner's: they sign in again, which is the safe outcome.
    expect((await refresh(rotated.body.refresh_token)).status).toBe(401);
  });

  it('rejects junk and unknown tokens', async () => {
    expect((await refresh('not-a-token')).status).toBe(401);
    const { refresh_token } = await start();
    await prisma.session.deleteMany();
    expect((await refresh(refresh_token)).body.code).toBe('SESSION_EXPIRED');
  });

  it('keeps an active session alive past the old 8-day pruning line', async () => {
    const { user, refresh_token } = await start();
    await prisma.session.updateMany({ where: { user_id: user.id }, data: { created_at: new Date(Date.now() - 20 * 86400000) } });
    await refresh(refresh_token);
    await createSession(user.id, { headers: {}, ip: '127.0.0.1' } as never); // pruning runs on sign-in
    expect(await prisma.session.count({ where: { user_id: user.id } })).toBe(2);
  });
});
