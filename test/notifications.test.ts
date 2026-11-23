import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createNotification } from '../src/lib/notify.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('notifications', () => {
  it('shows application notifications only while the recipient is an admissions admin', async () => {
    const admin = await makeUser({ role: 'admin' });
    const member = await makeUser();
    await createNotification(admin.user.id, 'application', 'New application TX-1', { link: '/admin/applications' });
    await createNotification(admin.user.id, 'system', 'Hello');
    await createNotification(member.user.id, 'application', 'New application TX-2', { link: '/admin/applications' });

    const list = () => request(app).get('/api/v1/notifications').set(admin.auth);
    const count = () => request(app).get('/api/v1/notifications/unread-count').set(admin.auth);
    expect((await list()).body).toHaveLength(2);
    expect((await count()).body.unread).toBe(2);
    expect((await request(app).get('/api/v1/notifications').set(member.auth)).body).toEqual([]);

    await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'member' } });
    expect((await list()).body.map((n: { type: string }) => n.type)).toEqual(['system']);
    expect((await count()).body.unread).toBe(1);
  });
  it('counts unread, marks read and deletes only my own', async () => {
    const me = await makeUser();
    const other = await makeUser();
    const mine = await createNotification(me.user.id, 'system', 'Welcome!', { link: '/home' });
    await createNotification(me.user.id, 'system', 'Second');
    const theirs = await createNotification(other.user.id, 'system', 'Not yours');

    expect((await request(app).get('/api/v1/notifications/unread-count').set(me.auth)).body.unread).toBe(2);

    await request(app).patch(`/api/v1/notifications/${mine!.id}/read`).set(me.auth);
    expect((await request(app).get('/api/v1/notifications/unread-count').set(me.auth)).body.unread).toBe(1);

    expect((await request(app).patch(`/api/v1/notifications/${theirs!.id}/read`).set(me.auth)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/notifications/${theirs!.id}`).set(me.auth)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/notifications/${mine!.id}`).set(me.auth)).status).toBe(200);

    const list = await request(app).get('/api/v1/notifications').set(me.auth);
    expect(list.body).toHaveLength(1);
    expect(await prisma.notification.count({ where: { user_id: other.user.id } })).toBe(1);
  });

  it('returns the link so the app knows where a notification leads', async () => {
    const me = await makeUser();
    await createNotification(me.user.id, 'system', 'Go here', { link: '/labs/x' });
    const list = await request(app).get('/api/v1/notifications').set(me.auth);
    expect(list.body[0].link).toBe('/labs/x');
  });
});
