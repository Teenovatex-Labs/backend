import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { awardPoints } from '../src/lib/points.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('points breakdown', () => {
  it('groups by the typed kind, over the whole history, not by wording', async () => {
    const me = await makeUser();
    await awardPoints(me.user.id, 'vote_received', 10, 'Anything at all');
    await awardPoints(me.user.id, 'vote_received', 10, 'Some tx wording that used to confuse the old text search');
    await awardPoints(me.user.id, 'vote_removed', -10, 'Vote removed');
    await awardPoints(me.user.id, 'streak', 3, 'x');
    await awardPoints(me.user.id, 'streak_milestone', 25, 'x');
    await awardPoints(me.user.id, 'lesson', 5, 'x');
    await awardPoints(me.user.id, 'post_tagged', 5, 'x');

    const res = await request(app).get('/api/v1/points/me').set(me.auth);
    expect(res.body.breakdown).toEqual({ votes_received: 10, posts_tagged: 5, streak_bonus: 28, lessons: 5 });
    expect(res.body.total_points).toBe(48);
  });

  it('counts real activity: a vote received then taken back nets to zero', async () => {
    const owner = await makeUser();
    const voter = await makeUser();
    const lab = await makeProject(owner.user.id);
    await request(app).post(`/api/v1/projects/${lab.id}/vote`).set(voter.auth);
    await request(app).delete(`/api/v1/projects/${lab.id}/vote`).set(voter.auth);
    const res = await request(app).get('/api/v1/points/me').set(owner.auth);
    expect(res.body.breakdown.votes_received).toBe(0);
    const kinds = (await prisma.pointsLog.findMany({ where: { user_id: owner.user.id } })).map((p) => p.kind).sort();
    expect(kinds).toEqual(['vote_received', 'vote_removed']);
  });
});
