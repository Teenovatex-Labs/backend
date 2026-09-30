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

  it('hands the SAME new token to anyone presenting the just-replaced one (two tabs, or a lost response)', async () => {
    const { refresh_token: first } = await start();
    const a = await refresh(first); // the first tab rotates
    const b = await refresh(first); // the second tab, or a retry after the response never arrived
    const c = await refresh(first);
    expect(b.status).toBe(200);
    expect(b.body.refresh_token).toBe(a.body.refresh_token);
    expect(c.body.refresh_token).toBe(a.body.refresh_token);
    expect(await prisma.session.count()).toBe(1);

    // And that token is the real current one: it works, and rotates on.
    const onward = await refresh(b.body.refresh_token);
    expect(onward.status).toBe(200);
    expect(onward.body.refresh_token).not.toBe(a.body.refresh_token);
  });

  it('survives a lost response without logging the member out a minute later', async () => {
    const { refresh_token: first, user } = await start();
    await refresh(first); // response lost: the browser still holds `first`
    // A few minutes later the browser tries again with what it still has.
    await prisma.session.updateMany({ where: { user_id: user.id }, data: { rotated_at: new Date(Date.now() - 4 * 60_000) } });
    const retry = await refresh(first);
    expect(retry.status).toBe(200);
    expect(retry.body.refresh_token).toBeTruthy();
  });

  it('lets simultaneous refreshes all succeed with one agreed token', async () => {
    const { refresh_token } = await start();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => refresh(refresh_token)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.refresh_token)).size).toBe(1);
    expect(await prisma.session.count()).toBe(1);
  });

  it('ends the session when an old token is replayed long after the grace window', async () => {
    const { refresh_token: first, user } = await start();
    const rotated = await refresh(first);
    await prisma.session.updateMany({ where: { user_id: user.id }, data: { rotated_at: new Date(Date.now() - REFRESH_GRACE_MS - 5_000) } });

    const replay = await refresh(first);
    expect(replay.status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
    // The thief's copy is dead, and so is the real owner's: they sign in again, which is the safe outcome.
    expect((await refresh(rotated.body.refresh_token)).status).toBe(401);
  });

  it('does not accept a token two rotations back', async () => {
    const { refresh_token: first } = await start();
    const second = await refresh(first);
    const third = await refresh(second.body.refresh_token);
    expect(third.status).toBe(200);
    expect((await refresh(first)).status).toBe(401); // neither current nor the one just before it
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
