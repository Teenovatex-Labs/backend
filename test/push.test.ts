import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createNotification } from '../src/lib/notify.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const sub = (n = 1) => ({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: 'BPubKeyBPubKeyBPubKey', auth: 'authsecret1' } });

describe('push subscriptions', () => {
  it('needs a signed-in member, and says whether push is configured', async () => {
    expect((await request(app).get('/api/v1/push/key')).status).toBe(401);
    const me = await makeUser();
    const res = await request(app).get('/api/v1/push/key').set(me.auth);
    expect(res.body).toEqual({ enabled: false, key: null }); // no VAPID keys in tests
  });

  it('saves a device once, forgets it on unsubscribe, and refuses insecure endpoints', async () => {
    const me = await makeUser();
    expect((await request(app).post('/api/v1/push/subscribe').set(me.auth).send(sub())).status).toBe(201);
    await request(app).post('/api/v1/push/subscribe').set(me.auth).send(sub()); // same device again
    expect(await prisma.pushSubscription.count()).toBe(1);

    expect((await request(app).post('/api/v1/push/subscribe').set(me.auth).send({ ...sub(2), endpoint: 'http://x.example.com/a' })).status).toBe(400);

    await request(app).post('/api/v1/push/unsubscribe').set(me.auth).send({ endpoint: sub().endpoint });
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('keeps only the newest ten devices', async () => {
    const me = await makeUser();
    for (let i = 1; i <= 12; i++) await request(app).post('/api/v1/push/subscribe').set(me.auth).send(sub(i));
    expect(await prisma.pushSubscription.count({ where: { user_id: me.user.id } })).toBe(10);
  });

  it('does not stop a notification from being saved when push is off', async () => {
    const me = await makeUser();
    await request(app).post('/api/v1/push/subscribe').set(me.auth).send(sub());
    const n = await createNotification(me.user.id, 'system', 'hello');
    expect(n?.message).toBe('hello');
  });
});
