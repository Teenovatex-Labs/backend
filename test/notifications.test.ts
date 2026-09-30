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
