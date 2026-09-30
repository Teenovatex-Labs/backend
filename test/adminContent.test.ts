import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/middleware/upload.js', async (orig) => ({ ...(await orig<typeof import('../src/middleware/upload.js')>()), uploadToCloudinary: vi.fn(async () => 'https://cdn.example.com/new-cover.png') }));

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/db.js');
const { makeProject, makeUser } = await import('./factories.js');
const { resetDb } = await import('./helpers.js');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const lessonBody = 'A lesson body that is comfortably longer than twenty characters.';

describe('managing Learn content', () => {
  it('is staff only', async () => {
    const member = await makeUser();
    expect((await request(app).get('/api/v1/admin/learn/tracks').set(member.auth)).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/learn/tracks').set(member.auth).send({ slug: 'x-y', title: 'Title', description: 'A description' })).status).toBe(403);
  });

  it('creates, edits, orders and removes tracks and lessons, with an audit trail', async () => {
    const admin = await makeUser({ role: 'admin' });
    const t = await request(app).post('/api/v1/admin/learn/tracks').set(admin.auth).send({ slug: 'first-site', title: 'First site', description: 'Build a website' });
    expect(t.status).toBe(201);
    const l1 = await request(app).post(`/api/v1/admin/learn/tracks/${t.body.id}/lessons`).set(admin.auth).send({ slug: 'html', title: 'HTML', summary: 'Tags', body: lessonBody });
    const l2 = await request(app).post(`/api/v1/admin/learn/tracks/${t.body.id}/lessons`).set(admin.auth).send({ slug: 'css', title: 'CSS', summary: 'Looks', body: lessonBody, minutes: 7 });
    expect([l1.body.position, l2.body.position]).toEqual([0, 1]);

    await request(app).patch(`/api/v1/admin/learn/lessons/${l2.body.id}`).set(admin.auth).send({ position: 0 });
    await request(app).patch(`/api/v1/admin/learn/lessons/${l1.body.id}`).set(admin.auth).send({ position: 1, title: 'HTML basics' });
    const member = await makeUser();
    const shown = await request(app).get('/api/v1/learn/tracks/first-site').set(member.auth);
    expect(shown.body.lessons.map((l: { slug: string }) => l.slug)).toEqual(['css', 'html']);
    expect(shown.body.lessons[1].title).toBe('HTML basics');

    await request(app).patch(`/api/v1/admin/learn/tracks/${t.body.id}`).set(admin.auth).send({ published: false });
    expect((await request(app).get('/api/v1/learn/tracks/first-site')).status).toBe(404); // unpublished is hidden from members
    expect((await request(app).get('/api/v1/admin/learn/tracks').set(admin.auth)).body.tracks).toHaveLength(1); // but staff still see it

    expect((await request(app).delete(`/api/v1/admin/learn/lessons/${l1.body.id}`).set(admin.auth)).status).toBe(200);
    expect((await request(app).delete(`/api/v1/admin/learn/tracks/${t.body.id}`).set(admin.auth)).status).toBe(200);
    const actions = (await prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['learn.track.create', 'learn.lesson.create', 'learn.lesson.update', 'learn.track.update', 'learn.lesson.delete', 'learn.track.delete']));
  });

  it('refuses bad input and duplicate addresses', async () => {
    const admin = await makeUser({ role: 'moderator' });
    const good = { slug: 'same-slug', title: 'Title', description: 'A description' };
    expect((await request(app).post('/api/v1/admin/learn/tracks').set(admin.auth).send({ ...good, slug: 'Bad Slug!' })).status).toBe(400);
    await request(app).post('/api/v1/admin/learn/tracks').set(admin.auth).send(good);
    expect((await request(app).post('/api/v1/admin/learn/tracks').set(admin.auth).send(good)).body.code).toBe('SLUG_TAKEN');
    const track = await prisma.track.findFirstOrThrow();
    expect((await request(app).post(`/api/v1/admin/learn/tracks/${track.id}/lessons`).set(admin.auth).send({ slug: 'l', title: 'Lesson', summary: 'Sum', body: 'too short' })).status).toBe(400);
    expect((await request(app).patch('/api/v1/admin/learn/tracks/missing').set(admin.auth).send({ title: 'New title' })).status).toBe(404);
  });

  it('keeps members’ progress when a lesson is edited', async () => {
    const admin = await makeUser({ role: 'admin' });
    const me = await makeUser();
    const t = await request(app).post('/api/v1/admin/learn/tracks').set(admin.auth).send({ slug: 'track-a', title: 'Track A', description: 'A description' });
    const l = await request(app).post(`/api/v1/admin/learn/tracks/${t.body.id}/lessons`).set(admin.auth).send({ slug: 'lesson-a', title: 'Lesson A', summary: 'Sum', body: lessonBody });
    await request(app).post(`/api/v1/learn/lessons/${l.body.id}/complete`).set(me.auth);
    await request(app).patch(`/api/v1/admin/learn/lessons/${l.body.id}`).set(admin.auth).send({ body: `${lessonBody} Now with more detail.` });
    expect(await prisma.lessonProgress.count()).toBe(1);
  });
});

describe('admin analytics', () => {
  it('counts signups and activity per day with no gaps, plus what members actually use', async () => {
    const admin = await makeUser({ role: 'admin' });
    const a = await makeUser();
    await makeUser();
    await makeProject(a.user.id);
    const res = await request(app).get('/api/v1/admin/analytics?days=7').set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.signups).toHaveLength(7);
    expect(res.body.signups.at(-1).count).toBe(3); // today
    expect(res.body.labs_started.at(-1).count).toBe(1);
    expect(res.body.adoption).toMatchObject({ users: 3, started_a_lab_pct: 33, voted_pct: 0 });
    expect((await request(app).get('/api/v1/admin/analytics').set(a.auth)).status).toBe(403);
  });
});

describe('lab cover image', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');

  it('can be replaced and cleared by the owner only', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const lab = await makeProject(owner.user.id, { cover_url: 'https://cdn.example.com/old.png' });

    const put = await request(app).put(`/api/v1/projects/${lab.id}/cover`).set(owner.auth).attach('cover_image', png, 'c.png');
    expect(put.status).toBe(200);
    expect(put.body.cover_url).toBe('https://cdn.example.com/new-cover.png');
    expect((await request(app).put(`/api/v1/projects/${lab.id}/cover`).set(other.auth).attach('cover_image', png, 'c.png')).status).toBe(403);
    expect((await request(app).put(`/api/v1/projects/${lab.id}/cover`).set(owner.auth)).body.code).toBe('NO_FILE');

    expect((await request(app).delete(`/api/v1/projects/${lab.id}/cover`).set(other.auth)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/projects/${lab.id}/cover`).set(owner.auth)).status).toBe(200);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: lab.id } })).cover_url).toBeNull();
  });
});
