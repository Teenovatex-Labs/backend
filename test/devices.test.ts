import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { describeDevice } from '../src/lib/device.js';
import { createSession, generateAccessToken } from '../src/lib/tokens.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const CHROME_LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe('describeDevice', () => {
  it('names the browser and system in plain words', () => {
    expect(describeDevice(CHROME_LINUX)).toMatchObject({ label: 'Chrome on Linux', kind: 'computer' });
    expect(describeDevice(CHROME_ANDROID)).toMatchObject({ label: 'Chrome on Android', kind: 'phone' });
    expect(describeDevice(SAFARI_IPHONE)).toMatchObject({ label: 'Safari on iOS', kind: 'phone' });
    expect(describeDevice(null).label).toBe('Unknown device');
  });
});

describe('device list', () => {
  it('shows readable names, finds this device, and can sign out the others', async () => {
    const { user } = await makeUser();
    const here = await createSession(user.id, { headers: { 'user-agent': CHROME_LINUX }, ip: '1.1.1.1' } as never);
    await createSession(user.id, { headers: { 'user-agent': CHROME_ANDROID }, ip: '2.2.2.2' } as never);
    const auth = { Authorization: `Bearer ${generateAccessToken(user.id)}` };

    const list = await request(app).get('/api/v1/settings/sessions').set(auth);
    expect(list.body.map((s: { device: { label: string } }) => s.device.label).sort()).toEqual(['Chrome on Android', 'Chrome on Linux']);

    const me = await request(app).post('/api/v1/settings/sessions/current').set(auth).send({ refresh_token: here.refresh_token });
    const mine = list.body.find((s: { device: { label: string } }) => s.device.label === 'Chrome on Linux');
    expect(me.body.id).toBe(mine.id);

    const out = await request(app).post('/api/v1/settings/sessions/revoke-others').set(auth).send({ refresh_token: here.refresh_token });
    expect(out.body.count).toBe(1);
    expect(await prisma.session.count({ where: { user_id: user.id } })).toBe(1);
  });

  it('refuses to sign everything out when it cannot tell which device is this one', async () => {
    const { user } = await makeUser();
    await createSession(user.id, { headers: {}, ip: '1.1.1.1' } as never);
    const auth = { Authorization: `Bearer ${generateAccessToken(user.id)}` };
    const res = await request(app).post('/api/v1/settings/sessions/revoke-others').set(auth).send({ refresh_token: 'not-a-real-token-at-all' });
    expect(res.status).toBe(400);
    expect(await prisma.session.count()).toBe(1);
  });
});
