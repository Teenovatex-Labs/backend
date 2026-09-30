import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const find = (q: string, auth?: Record<string, string>) => {
  const r = request(app).get('/api/v1/search').query({ q });
  return auth ? r.set(auth) : r;
};

describe('search', () => {
  it('finds labs, people, posts, lessons and events, case-insensitively', async () => {
    const me = await makeUser();
    const maker = await makeUser({ username: 'planet_fan', full_name: 'Planet Fan' });
    await makeProject(maker.user.id, { name: 'Pocket Planets', short_description: 'Tiny solar system' });
    const space = await prisma.space.create({ data: { slug: 'g', name: 'General', description: 'x' } });
    await prisma.post.create({ data: { space_id: space.id, author_id: maker.user.id, title: 'Planet physics help', body: 'How do orbits work?' } });
    await prisma.track.create({ data: { slug: 't', title: 'Track', description: 'd', lessons: { create: [{ slug: 'l', title: 'Planets and scale', summary: 's', body: 'b', position: 1 }] } } });
    await prisma.event.create({ data: { title: 'Planet party', description: 'fun', starts_at: new Date() } });

    const res = await find('PLANET', me.auth);
    expect(res.body.labs.map((l: { name: string }) => l.name)).toEqual(['Pocket Planets']);
    expect(res.body.people.map((p: { username: string }) => p.username)).toEqual(['planet_fan']);
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.lessons[0]).toMatchObject({ title: 'Planets and scale', track: { slug: 't' } });
    expect(res.body.events).toHaveLength(1);
  });

  it('needs at least two characters, and works signed out', async () => {
    expect((await find('p')).body).toEqual({ q: 'p', labs: [], people: [], posts: [], lessons: [], events: [] });
    const maker = await makeUser();
    await makeProject(maker.user.id, { name: 'Zebra Lab' });
    expect((await find('zebra')).body.labs).toHaveLength(1);
  });

  it('matches lab tags', async () => {
    const maker = await makeUser();
    await makeProject(maker.user.id, { name: 'Thing', tags: ['physics'] });
    expect((await find('physics')).body.labs).toHaveLength(1);
  });

  it('never reveals private profiles, hidden posts, or blocked members', async () => {
    const me = await makeUser();
    const shy = await makeUser({ username: 'quiet_quinn' });
    await prisma.userSettings.update({ where: { user_id: shy.user.id }, data: { public_profile: false } });
    const blocked = await makeUser({ username: 'quiet_blocked' });
    await prisma.block.create({ data: { blocker_id: me.user.id, blocked_id: blocked.user.id } });
    const space = await prisma.space.create({ data: { slug: 'g', name: 'General', description: 'x' } });
    const author = await makeUser();
    await prisma.post.create({ data: { space_id: space.id, author_id: author.user.id, title: 'quiet removed post', body: 'x', hidden: true } });
    await prisma.post.create({ data: { space_id: space.id, author_id: blocked.user.id, title: 'quiet from blocked', body: 'x' } });
    await makeProject(blocked.user.id, { name: 'quiet lab by blocked' });

    const res = await find('quiet', me.auth);
    expect(res.body.people).toEqual([]);
    expect(res.body.posts).toEqual([]);
    expect(res.body.labs).toEqual([]);
  });

  it('treats wildcard characters as plain text', async () => {
    const me = await makeUser();
    const maker = await makeUser();
    await makeProject(maker.user.id, { name: 'Plain lab' });
    const res = await find('%%', me.auth);
    expect(res.body.labs).toEqual([]);
  });
});
