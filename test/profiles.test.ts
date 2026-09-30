import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('public profiles', () => {
  it('shows lab count and rank, and no follower numbers', async () => {
    const star = await makeUser({ points: 50 });
    const fan = await makeUser();
    await makeProject(star.user.id);

    const res = await request(app).get(`/api/v1/users/${star.user.username}`).set(fan.auth);
    expect(res.body).toMatchObject({ lab_count: 1, rank: 1, private: false });
    expect(res.body).not.toHaveProperty('followers');
    expect(res.body).not.toHaveProperty('following');
    expect(res.body).not.toHaveProperty('is_following');
    expect(res.body.birth_date).toBeUndefined();
    expect(res.body.email).toBeUndefined();

  });

  it('has no follow endpoint at all', async () => {
    const star = await makeUser();
    const fan = await makeUser();
    expect((await request(app).post(`/api/v1/users/${star.user.username}/follow`).set(fan.auth)).status).toBe(404);
  });

  it('hides a private profile from everyone but its owner', async () => {
    const shy = await makeUser();
    await prisma.userSettings.update({ where: { user_id: shy.user.id }, data: { public_profile: false } });
    await makeProject(shy.user.id);
    const other = await makeUser();

    const seen = await request(app).get(`/api/v1/users/${shy.user.username}`).set(other.auth);
    expect(seen.body).toEqual({ username: shy.user.username, avatar_url: null, private: true });
    expect((await request(app).get(`/api/v1/users/${shy.user.username}/projects`).set(other.auth)).body.projects).toEqual([]);

    const own = await request(app).get(`/api/v1/users/${shy.user.username}`).set(shy.auth);
    expect(own.body.private).toBe(false);
    expect((await request(app).get(`/api/v1/users/${shy.user.username}/projects`).set(shy.auth)).body.projects).toHaveLength(1);
  });

  it('lists a member’s labs', async () => {
    const a = await makeUser();
    await makeProject(a.user.id);
    await makeProject(a.user.id);
    const res = await request(app).get(`/api/v1/users/${a.user.username}/projects`);
    expect(res.body.projects).toHaveLength(2);
  });
});
