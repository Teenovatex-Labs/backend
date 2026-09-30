import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const post = (auth: Record<string, string>, body: object) => request(app).post('/api/v1/announcements').set(auth).send(body);

describe('announcements', () => {
  it('can be posted only by staff, and seen by every member', async () => {
    const admin = await makeUser({ role: 'admin' });
    const member = await makeUser();
    expect((await post(member.auth, { title: 'Hello', body: 'World' })).status).toBe(403);
    expect((await post(admin.auth, { title: 'Lab Night is Friday', body: 'Bring something you built.', link: '/events' })).status).toBe(201);
    const seen = await request(app).get('/api/v1/announcements').set(member.auth);
    expect(seen.body.announcements).toHaveLength(1);
    expect(seen.body.announcements[0]).toMatchObject({ title: 'Lab Night is Friday', link: '/events' });
    expect((await request(app).get('/api/v1/announcements')).status).toBe(401);
  });

  it('only links inside the app, never to another website', async () => {
    const admin = await makeUser({ role: 'admin' });
    for (const link of ['https://evil.example.com', '//evil.example.com', 'javascript:alert(1)', 'events']) {
      expect((await post(admin.auth, { title: 'Hello', body: 'World', link })).status).toBe(400);
    }
    expect((await post(admin.auth, { title: 'Hello', body: 'World', link: '/labs/my-lab?tab=board' })).status).toBe(201);
  });

  it('hides expired and old announcements from members, but staff can still see and remove them', async () => {
    const admin = await makeUser({ role: 'admin' });
    const member = await makeUser();
    await prisma.announcement.create({ data: { title: 'Expired', body: 'x', expires_at: new Date(Date.now() - 1000) } });
    await prisma.announcement.create({ data: { title: 'Ancient', body: 'x', created_at: new Date(Date.now() - 30 * 86400000) } });
    const live = await post(admin.auth, { title: 'Live', body: 'some words' });

    const seen = await request(app).get('/api/v1/announcements').set(member.auth);
    expect(seen.body.announcements.map((a: { title: string }) => a.title)).toEqual(['Live']);
    expect((await request(app).get('/api/v1/announcements/all').set(member.auth)).status).toBe(403);
    expect((await request(app).get('/api/v1/announcements/all').set(admin.auth)).body.announcements).toHaveLength(3);

    expect((await request(app).delete(`/api/v1/announcements/${live.body.id}`).set(admin.auth)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: 'announcement.' } } })).toBe(2);
    expect((await request(app).delete(`/api/v1/announcements/${live.body.id}`).set(admin.auth)).status).toBe(404);
  });

  it('shows at most the three newest', async () => {
    const admin = await makeUser({ role: 'admin' });
    for (const t of ['One', 'Two', 'Three', 'Four']) await post(admin.auth, { title: `${t} news`, body: 'some words' });
    const seen = await request(app).get('/api/v1/announcements').set(admin.auth);
    expect(seen.body.announcements).toHaveLength(3);
  });
});
