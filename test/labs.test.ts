import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { dayToDb, localDay } from '../src/lib/day.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('labs (projects) reads', () => {
  it('opens a lab by slug as well as by id', async () => {
    const { user } = await makeUser();
    const lab = await makeProject(user.id, { slug: 'my-first-lab' });
    expect((await request(app).get('/api/v1/projects/my-first-lab')).body.id).toBe(lab.id);
    expect((await request(app).get(`/api/v1/projects/${lab.id}`)).body.slug).toBe('my-first-lab');
    expect((await request(app).get('/api/v1/projects/nope')).status).toBe(404);
  });

  it('lists only my own labs on /mine', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeProject(a.user.id);
    await makeProject(a.user.id);
    await makeProject(b.user.id);
    const res = await request(app).get('/api/v1/projects/mine').set(a.auth);
    expect(res.body.total).toBe(2);
    expect((await request(app).get('/api/v1/projects/mine')).status).toBe(401);
  });

  it('counts labs per category', async () => {
    const { user } = await makeUser();
    await makeProject(user.id, { category: 'web' });
    await makeProject(user.id, { category: 'web' });
    await makeProject(user.id, { category: 'ai' });
    const res = await request(app).get('/api/v1/projects/categories');
    expect(res.body.categories).toEqual([
      { name: 'ai', count: 1 },
      { name: 'web', count: 2 },
    ]);
  });

  it('marks labs the member already voted on today', async () => {
    const owner = await makeUser();
    const me = await makeUser();
    const voted = await makeProject(owner.user.id);
    const fresh = await makeProject(owner.user.id);
    await prisma.vote.create({ data: { user_id: me.user.id, project_id: voted.id, vote_day: dayToDb(localDay(null)) } });

    const list = await request(app).get('/api/v1/projects').set(me.auth);
    const flag = (id: string) => list.body.projects.find((p: { id: string }) => p.id === id).has_voted_today;
    expect(flag(voted.id)).toBe(true);
    expect(flag(fresh.id)).toBe(false);

    const one = await request(app).get(`/api/v1/projects/${voted.id}`).set(me.auth);
    expect(one.body.has_voted_today).toBe(true);
    expect((await request(app).get(`/api/v1/projects/${voted.id}`)).body.has_voted_today).toBe(false);
  });

  it('ranks trending by votes from the last week, not all time', async () => {
    const owner = await makeUser();
    const voter = await makeUser();
    const oldFavourite = await makeProject(owner.user.id, { vote_count: 50 });
    const risingStar = await makeProject(owner.user.id, { vote_count: 2 });
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await prisma.vote.create({ data: { user_id: voter.user.id, project_id: oldFavourite.id, vote_day: dayToDb('2020-01-01'), voted_at: old } });
    await prisma.vote.create({ data: { user_id: voter.user.id, project_id: risingStar.id, vote_day: dayToDb(localDay(null)) } });

    const res = await request(app).get('/api/v1/projects?sort=trending');
    expect(res.body.projects.map((p: { id: string }) => p.id)).toEqual([risingStar.id, oldFavourite.id]);
  });

  it('survives junk paging values', async () => {
    const res = await request(app).get('/api/v1/projects?page=abc&limit=-4');
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
  });
});
