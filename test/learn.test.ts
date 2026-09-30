import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const seedTrack = async () =>
  prisma.track.create({
    data: {
      slug: 'first-site',
      title: 'Your first website',
      description: 'From nothing to online.',
      lessons: {
        create: [
          { slug: 'what-is-a-website', title: 'What is a website?', summary: 'The big picture', body: 'A website is files.', minutes: 4, position: 1 },
          { slug: 'html-basics', title: 'HTML basics', summary: 'Tags', body: '## Tags\n\nText.', minutes: 6, position: 2 },
        ],
      },
    },
    include: { lessons: { orderBy: { position: 'asc' } } },
  });

describe('learn', () => {
  it('lists published tracks with lesson counts and my progress', async () => {
    const track = await seedTrack();
    await prisma.track.create({ data: { slug: 'draft', title: 'Hidden', description: 'x', published: false } });
    const me = await makeUser();
    await prisma.lessonProgress.create({ data: { user_id: me.user.id, lesson_id: track.lessons[0]!.id } });

    const res = await request(app).get('/api/v1/learn/tracks').set(me.auth);
    expect(res.body.tracks).toHaveLength(1);
    expect(res.body.tracks[0]).toMatchObject({ slug: 'first-site', lesson_count: 2, minutes: 10, completed_count: 1 });
    expect((await request(app).get('/api/v1/learn/tracks')).body.tracks[0].completed_count).toBe(0);
  });

  it('opens a track and a lesson with neighbours', async () => {
    await seedTrack();
    const track = await request(app).get('/api/v1/learn/tracks/first-site');
    expect(track.body.lessons.map((l: { slug: string }) => l.slug)).toEqual(['what-is-a-website', 'html-basics']);

    const lesson = await request(app).get('/api/v1/learn/tracks/first-site/lessons/what-is-a-website');
    expect(lesson.body).toMatchObject({ title: 'What is a website?', prev: null, next: { slug: 'html-basics' } });
    expect((await request(app).get('/api/v1/learn/tracks/first-site/lessons/nope')).status).toBe(404);
    expect((await request(app).get('/api/v1/learn/tracks/nope')).status).toBe(404);
  });

  it('pays 5 points the first time a lesson is finished, never again', async () => {
    const track = await seedTrack();
    const me = await makeUser();
    const id = track.lessons[0]!.id;

    const first = await request(app).post(`/api/v1/learn/lessons/${id}/complete`).set(me.auth);
    expect(first.body).toEqual({ completed: true, points_awarded: 5 });
    const second = await request(app).post(`/api/v1/learn/lessons/${id}/complete`).set(me.auth);
    expect(second.body.points_awarded).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: me.user.id } })).points).toBe(5);

    const shown = await request(app).get('/api/v1/learn/tracks/first-site/lessons/what-is-a-website').set(me.auth);
    expect(shown.body.completed).toBe(true);
  });

  it('cannot be double-paid by simultaneous requests', async () => {
    const track = await seedTrack();
    const me = await makeUser();
    const id = track.lessons[0]!.id;
    await Promise.all([1, 2, 3, 4].map(() => request(app).post(`/api/v1/learn/lessons/${id}/complete`).set(me.auth)));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: me.user.id } })).points).toBe(5);
  });

  it('needs sign-in and a real lesson', async () => {
    const me = await makeUser();
    expect((await request(app).post('/api/v1/learn/lessons/x/complete')).status).toBe(401);
    expect((await request(app).post('/api/v1/learn/lessons/missing/complete').set(me.auth)).status).toBe(404);
  });
});
