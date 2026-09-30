import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { connectedCount, publish } from '../src/lib/realtime.js';
import { createNotification } from '../src/lib/notify.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

let server: http.Server;
let base: string;
const open: http.ClientRequest[] = [];

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(resetDb);
afterEach(() => {
  while (open.length) open.pop()!.destroy();
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
});

/** Opens the live stream and collects what arrives. */
const listen = (auth: Record<string, string>) =>
  new Promise<{ events: string[]; status: number; headers: http.IncomingHttpHeaders }>((resolve) => {
    const events: string[] = [];
    const req = http.get(`${base}/api/v1/realtime`, { headers: auth }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        for (const line of chunk.split('\n')) if (line.startsWith('data: ')) events.push(line.slice(6));
      });
      resolve({ events, status: res.statusCode!, headers: res.headers });
    });
    open.push(req);
  });
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe('live updates', () => {
  it('needs a signed-in member', async () => {
    expect((await request(app).get('/api/v1/realtime')).status).toBe(401);
  });

  it('opens a stream that nginx will not buffer', async () => {
    const me = await makeUser();
    const { status, headers } = await listen(me.auth);
    expect(status).toBe(200);
    expect(headers['content-type']).toMatch(/text\/event-stream/);
    expect(headers['x-accel-buffering']).toBe('no');
    await wait();
    expect(connectedCount(me.user.id)).toBe(1);
  });

  it('pushes a new notification the moment it is created', async () => {
    const me = await makeUser();
    const s = await listen(me.auth);
    await wait();
    await createNotification(me.user.id, 'system', 'hello');
    await wait();
    expect(s.events.map((e) => JSON.parse(e))).toEqual([{ type: 'notification' }]);
  });

  it('pushes new chat messages to the other person only', async () => {
    const a = await makeUser({ created_at: new Date(Date.now() - 30 * 86400000) });
    const b = await makeUser({ created_at: new Date(Date.now() - 30 * 86400000) });
    const { body: c } = await request(app).post('/api/v1/messages/conversations').set(a.auth).send({ username: b.user.username });
    const forB = await listen(b.auth);
    const forA = await listen(a.auth);
    await wait();
    await request(app).post(`/api/v1/messages/conversations/${c.id}/messages`).set(a.auth).send({ body: 'hey there' });
    await wait();
    expect(forB.events.map((e) => JSON.parse(e))).toContainEqual({ type: 'message', conversation_id: c.id });
    expect(forA.events.map((e) => JSON.parse(e)).filter((e) => e.type === 'message')).toEqual([]);
  });

  it('keeps each member’s events to themselves', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const forB = await listen(b.auth);
    await wait();
    publish(a.user.id, { type: 'notification' });
    await wait();
    expect(forB.events).toEqual([]);
  });

  it('limits how many tabs one member can hold open, closing the oldest', async () => {
    const me = await makeUser();
    for (let i = 0; i < 6; i++) await listen(me.auth);
    await wait(250);
    expect(connectedCount(me.user.id)).toBeLessThanOrEqual(4);
  });

  it('forgets a connection when the tab closes', async () => {
    const me = await makeUser();
    await listen(me.auth);
    await wait();
    open.pop()!.destroy();
    await wait(250);
    expect(connectedCount(me.user.id)).toBe(0);
  });
});
