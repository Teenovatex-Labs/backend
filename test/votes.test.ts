import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { localDay } from '../src/lib/day.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

const vote = (id: string, auth: Record<string, string>) => request(app).post(`/api/v1/projects/${id}/vote`).set(auth);
const unvote = (id: string, auth: Record<string, string>) => request(app).delete(`/api/v1/projects/${id}/vote`).set(auth);

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('voting', () => {
  it('counts a vote and pays the lab owner once', async () => {
    const owner = await makeUser();
    const voter = await makeUser();
    const lab = await makeProject(owner.user.id);

    const res = await vote(lab.id, voter.auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ new_vote_count: 1, points_awarded: 10, votes_remaining_today: 2 });
    expect((await prisma.user.findUnique({ where: { id: owner.user.id } }))?.points).toBe(10);
  });

  it('refuses a second vote on the same lab the same day', async () => {
    const owner = await makeUser();
    const voter = await makeUser();
    const lab = await makeProject(owner.user.id);
    await vote(lab.id, voter.auth);
    const again = await vote(lab.id, voter.auth);
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('ALREADY_VOTED');
  });

  it('allows three votes a day across labs, then stops', async () => {
    const owner = await makeUser();
    const voter = await makeUser();
    const labs = await Promise.all([1, 2, 3, 4].map(() => makeProject(owner.user.id)));
    for (const lab of labs.slice(0, 3)) expect((await vote(lab.id, voter.auth)).status).toBe(200);
    const fourth = await vote(labs[3]!.id, voter.auth);
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe('VOTE_LIMIT');
  });

  it('cannot be beaten by firing requests at once', async () => {
    const owner = await makeUser();
    const voter = await makeUser();
    const labs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => makeProject(owner.user.id)));
    const results = await Promise.all(labs.map((l) => vote(l.id, voter.auth)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);

    const one = await makeProject(owner.user.id);
    const other = await makeUser();
    const same = await Promise.all([1, 2, 3, 4].map(() => vote(one.id, other.auth)));
    expect(same.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await prisma.project.findUnique({ where: { id: one.id } }))?.vote_count).toBe(1);
  });

  it('gives no points for voting on your own lab', async () => {
    const owner = await makeUser();
    const lab = await makeProject(owner.user.id);
    const res = await vote(lab.id, owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.points_awarded).toBe(0);
    expect((await prisma.user.findUnique({ where: { id: owner.user.id } }))?.points).toBe(0);
  });

  it('takes the points back when a vote is removed', async () => {
    const owner = await makeUser();
    const voter = await makeUser();
    const lab = await makeProject(owner.user.id);
    await vote(lab.id, voter.auth);

    const res = await unvote(lab.id, voter.auth);
    expect(res.status).toBe(200);
    expect(res.body.new_vote_count).toBe(0);
    expect((await prisma.user.findUnique({ where: { id: owner.user.id } }))?.points).toBe(0);
    expect((await unvote(lab.id, voter.auth)).status).toBe(404);
  });

  it('files each vote under the voter’s own day', async () => {
    const owner = await makeUser();
    const voter = await makeUser({ timezone: 'Pacific/Kiritimati' }); // UTC+14
    const lab = await makeProject(owner.user.id);
    await vote(lab.id, voter.auth);
    const stored = await prisma.vote.findFirstOrThrow({ where: { user_id: voter.user.id } });
    expect(stored.vote_day.toISOString().slice(0, 10)).toBe(localDay('Pacific/Kiritimati'));
  });

  it('reports the daily allowance and when it resets', async () => {
    const owner = await makeUser();
    const voter = await makeUser();
    const lab = await makeProject(owner.user.id);
    await vote(lab.id, voter.auth);
    const res = await request(app).get('/api/v1/votes/my-daily-status').set(voter.auth);
    expect(res.body.votes_used_today).toBe(1);
    expect(res.body.votes_remaining).toBe(2);
    expect(new Date(res.body.resets_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('notifies the owner with a link, unless they switched vote alerts off', async () => {
    const owner = await makeUser();
    const quiet = await makeUser();
    await prisma.userSettings.update({ where: { user_id: quiet.user.id }, data: { vote_alerts: false } });
    const voter = await makeUser();
    const a = await makeProject(owner.user.id);
    const b = await makeProject(quiet.user.id);
    await vote(a.id, voter.auth);
    await vote(b.id, voter.auth);

    const note = await prisma.notification.findFirstOrThrow({ where: { user_id: owner.user.id } });
    expect(note.link).toBe(`/labs/${a.slug}`);
    expect(await prisma.notification.count({ where: { user_id: quiet.user.id } })).toBe(0);
  });
});
