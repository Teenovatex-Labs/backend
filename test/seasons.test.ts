import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { awardPoints } from '../src/lib/points.js';
import { currentSeason } from '../src/lib/seasons.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('points and seasons', () => {
  it('stores fractional awards exactly and tags them with the current season', async () => {
    const { user } = await makeUser();
    await awardPoints(user.id, 'other', 0.3, 'a');
    await awardPoints(user.id, 'other', 0.3, 'b');
    await awardPoints(user.id, 'other', 0.5, 'c');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).points).toBe(110);
    const season = await currentSeason();
    expect(await prisma.pointsLog.count({ where: { user_id: user.id, season_id: season.id } })).toBe(3);
  });

  it('shows points in plain units over the API', async () => {
    const { user, auth } = await makeUser();
    await awardPoints(user.id, 'other', 1.5, 'x');
    expect((await request(app).get('/api/v1/users/me').set(auth)).body.points).toBe(1.5);
    const mine = await request(app).get('/api/v1/points/me').set(auth);
    expect(mine.body.total_points).toBe(1.5);
    expect(mine.body.activity[0].points).toBe(1.5);
  });

  it('starts a season: archives totals, resets points, opens the next, audits it', async () => {
    const admin = await makeUser({ role: 'admin' });
    const a = await makeUser();
    const b = await makeUser();
    await awardPoints(a.user.id, 'other', 12.5, 'x');
    await awardPoints(b.user.id, 'other', 3, 'y');
    const first = await currentSeason();

    const res = await request(app).post('/api/v1/admin/seasons/start').set(admin.auth).send({ confirm: true, name: 'Season 1: Launch' });
    expect(res.status).toBe(201);
    expect(res.body.archived_members).toBe(2);
    expect(res.body.current).toMatchObject({ number: first.number + 1, name: 'Season 1: Launch', is_current: true });

    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).points).toBe(0);
    expect((await prisma.seasonTotal.findUniqueOrThrow({ where: { user_id_season_id: { user_id: a.user.id, season_id: first.id } } })).points).toBe(1250);
    expect((await prisma.season.findUniqueOrThrow({ where: { id: first.id } })).is_current).toBe(false);
    expect(await prisma.season.count({ where: { is_current: true } })).toBe(1);

    await awardPoints(a.user.id, 'other', 1, 'new season');
    const now = await currentSeason();
    expect((await prisma.pointsLog.findFirstOrThrow({ where: { reason: 'new season' } })).season_id).toBe(now.id);
    expect(await prisma.auditLog.count({ where: { action: 'season.start' } })).toBe(1);

    const totals = await request(app).get(`/api/v1/admin/seasons/${first.id}/totals`).set(admin.auth);
    expect(totals.body.items.map((i: { points: number }) => i.points)).toEqual([12.5, 3]);
  });

  it('needs explicit confirmation and the points.manage permission', async () => {
    const admin = await makeUser({ role: 'admin' });
    const mod = await makeUser({ role: 'moderator' });
    expect((await request(app).post('/api/v1/admin/seasons/start').set(admin.auth).send({})).status).toBe(400);
    expect((await request(app).post('/api/v1/admin/seasons/start').set(mod.auth).send({ confirm: true })).status).toBe(403);
    expect(await prisma.season.count()).toBe(0);
  });
});
