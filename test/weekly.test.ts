import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const earn = (user_id: string, points: number, daysAgo = 0) =>
  prisma.pointsLog.create({ data: { user_id, points, reason: 'test', kind: 'other', created_at: new Date(Date.now() - daysAgo * 86400000) } });

describe('the weekly leaderboard', () => {
  it('ranks by points earned in the last 7 days, not all time', async () => {
    const veteran = await makeUser({ points: 1000 });
    const rising = await makeUser({ points: 30 });
    await earn(veteran.user.id, 1000, 40); // a long time ago
    await earn(veteran.user.id, 5, 1);
    await earn(rising.user.id, 30, 2);

    const week = await request(app).get('/api/v1/leaderboard?period=week');
    expect(week.body.period).toBe('week');
    expect(week.body.leaderboard.map((r: { username: string; points: number }) => [r.username, r.points])).toEqual([
      [rising.user.username, 30],
      [veteran.user.username, 5],
    ]);
    const all = await request(app).get('/api/v1/leaderboard');
    expect(all.body.leaderboard[0].username).toBe(veteran.user.username);
  });

  it('ignores points that were taken back, and members with nothing this week', async () => {
    const a = await makeUser();
    const quiet = await makeUser();
    await earn(a.user.id, 10, 1);
    await earn(a.user.id, -10, 1); // a vote removed
    await earn(quiet.user.id, 50, 20);
    const week = await request(app).get('/api/v1/leaderboard?period=week');
    expect(week.body.leaderboard.map((r: { username: string }) => r.username)).toEqual([a.user.username]);
  });

  it('pages and survives junk paging values', async () => {
    const people = await Promise.all([1, 2, 3].map(() => makeUser()));
    for (const [i, p] of people.entries()) await earn(p.user.id, 10 * (i + 1), 1);
    const page2 = await request(app).get('/api/v1/leaderboard?period=week&limit=2&page=2');
    expect(page2.body.leaderboard).toHaveLength(1);
    expect(page2.body.leaderboard[0].rank).toBe(3);
    expect((await request(app).get('/api/v1/leaderboard?period=week&limit=abc&page=-4')).status).toBe(200);
  });
});
