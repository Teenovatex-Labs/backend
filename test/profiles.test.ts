import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('public profiles', () => {
  it('shows counts, rank and whether I follow them', async () => {
    const star = await makeUser({ points: 50 });
    const fan = await makeUser();
    await makeProject(star.user.id);

    await request(app).post(`/api/v1/users/${star.user.username}/follow`).set(fan.auth);
    const res = await request(app).get(`/api/v1/users/${star.user.username}`).set(fan.auth);
    expect(res.body).toMatchObject({ followers: 1, following: 0, lab_count: 1, is_following: true, rank: 1, private: false });
    expect(res.body.birth_date).toBeUndefined();
    expect(res.body.email).toBeUndefined();

    const anon = await request(app).get(`/api/v1/users/${star.user.username}`);
    expect(anon.body.is_following).toBe(false);
  });

  it('tells a member when someone follows them, once', async () => {
    const star = await makeUser();
    const fan = await makeUser();
    await request(app).post(`/api/v1/users/${star.user.username}/follow`).set(fan.auth);
    await request(app).post(`/api/v1/users/${star.user.username}/follow`).set(fan.auth);
    const notes = await prisma.notification.findMany({ where: { user_id: star.user.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.link).toBe(`/u/${fan.user.username}`);
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
