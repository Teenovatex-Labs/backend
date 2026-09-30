import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { generateAccessToken } from '../src/lib/tokens.js';
import { resetDb } from './helpers.js';

// A member who came in through Google: placeholder handle, not chosen yet.
const makeGoogleMember = async (username_set = false) => {
  const tag = Math.random().toString(36).slice(2, 8);
  const user = await prisma.user.create({
    data: {
      email: `g_${tag}@example.com`,
      username: `user_${tag}`,
      username_set,
      full_name: 'Google Member',
      email_verified: true,
      birth_date: new Date('2008-05-10T00:00:00.000Z'),
    },
  });
  return { user, auth: { Authorization: `Bearer ${generateAccessToken(user.id)}` } };
};

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('choosing a username after Google sign-up', () => {
  it('reports username_set false until one is chosen, then saves it once', async () => {
    const { auth } = await makeGoogleMember();
    expect((await request(app).get('/api/v1/users/me').set(auth)).body.username_set).toBe(false);

    const res = await request(app).post('/api/v1/users/me/username').set(auth).send({ username: 'Builder_Bee' });
    expect(res.status).toBe(200);

    const me = await request(app).get('/api/v1/users/me').set(auth);
    expect(me.body.username).toBe('Builder_Bee');
    expect(me.body.username_set).toBe(true);

    const again = await request(app).post('/api/v1/users/me/username').set(auth).send({ username: 'another_one' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_SET');
  });

  it('refuses a taken username regardless of letter case', async () => {
    await makeGoogleMember(true).then(({ user }) => prisma.user.update({ where: { id: user.id }, data: { username: 'Taken_Name' } }));
    const { auth } = await makeGoogleMember();
    const res = await request(app).post('/api/v1/users/me/username').set(auth).send({ username: 'taken_name' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('USERNAME_TAKEN');
  });

  it('rejects usernames that are too short or use odd characters', async () => {
    const { auth } = await makeGoogleMember();
    expect((await request(app).post('/api/v1/users/me/username').set(auth).send({ username: 'ab' })).status).toBe(400);
    expect((await request(app).post('/api/v1/users/me/username').set(auth).send({ username: 'no spaces!' })).status).toBe(400);
  });

  it('blocks posting and voting until a username is chosen', async () => {
    const { auth } = await makeGoogleMember();
    const create = await request(app).post('/api/v1/projects').set(auth).field('name', 'My Lab');
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('USERNAME_REQUIRED');
    const vote = await request(app).post('/api/v1/projects/anything/vote').set(auth);
    expect(vote.body.code).toBe('USERNAME_REQUIRED');
  });
});
