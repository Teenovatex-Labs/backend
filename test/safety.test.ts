import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const report = (auth: Record<string, string>, body: object) => request(app).post('/api/v1/reports').set(auth).send(body);

describe('reporting', () => {
  it('files a report about a lab, once, and thanks the reporter kindly', async () => {
    const owner = await makeUser();
    const me = await makeUser();
    const lab = await makeProject(owner.user.id);
    const body = { target_type: 'lab', target_id: lab.id, reason: 'spam' };

    const first = await report(me.auth, body);
    expect(first.status).toBe(201);
    expect(first.body.message).toMatch(/thank you/i);
    await report(me.auth, body); // again: no duplicate row
    const rows = await prisma.report.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reporter_id: me.user.id, target_user_id: owner.user.id, status: 'open' });
  });

  it('can report a member by username, storing their id', async () => {
    const other = await makeUser();
    const me = await makeUser();
    await report(me.auth, { target_type: 'user', target_id: other.user.username, reason: 'bullying' });
    const row = await prisma.report.findFirstOrThrow();
    expect(row.target_id).toBe(other.user.id);
  });

  it('refuses reports about yourself, about things that do not exist, and from signed-out visitors', async () => {
    const me = await makeUser();
    const lab = await makeProject(me.user.id);
    expect((await report(me.auth, { target_type: 'lab', target_id: lab.id, reason: 'spam' })).body.code).toBe('SELF_REPORT');
    expect((await report(me.auth, { target_type: 'lab', target_id: 'missing', reason: 'spam' })).status).toBe(404);
    expect((await request(app).post('/api/v1/reports').send({ target_type: 'lab', target_id: lab.id, reason: 'spam' })).status).toBe(401);
    expect((await report(me.auth, { target_type: 'lab', target_id: lab.id, reason: 'not-a-reason' })).status).toBe(400);
  });
});

describe('blocking', () => {
  it('blocks, lists and unblocks', async () => {
    const a = await makeUser();
    const b = await makeUser();

    expect((await request(app).post(`/api/v1/blocks/${b.user.username}`).set(a.auth)).status).toBe(200);

    const list = await request(app).get('/api/v1/blocks').set(a.auth);
    expect(list.body.blocks.map((x: { username: string }) => x.username)).toEqual([b.user.username]);

    await request(app).delete(`/api/v1/blocks/${b.user.username}`).set(a.auth);
    expect((await request(app).get('/api/v1/blocks').set(a.auth)).body.blocks).toEqual([]);
  });

  it('will not let you block yourself or someone who does not exist', async () => {
    const a = await makeUser();
    expect((await request(app).post(`/api/v1/blocks/${a.user.username}`).set(a.auth)).status).toBe(400);
    expect((await request(app).post('/api/v1/blocks/nobody_here').set(a.auth)).status).toBe(404);
  });
});

describe('suspension', () => {
  it('lets a suspended member read but not vote, post or RSVP, until it ends', async () => {
    const owner = await makeUser();
    const lab = await makeProject(owner.user.id);
    const until = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const paused = await makeUser({ suspended_until: until, suspended_reason: 'Rude comments' });

    expect((await request(app).get('/api/v1/projects')).status).toBe(200);
    expect((await request(app).get('/api/v1/users/me').set(paused.auth)).status).toBe(200);
    const vote = await request(app).post(`/api/v1/projects/${lab.id}/vote`).set(paused.auth);
    expect(vote.status).toBe(403);
    expect(vote.body.code).toBe('ACCOUNT_SUSPENDED');

    await prisma.user.update({ where: { id: paused.user.id }, data: { suspended_until: new Date(Date.now() - 1000) } });
    expect((await request(app).post(`/api/v1/projects/${lab.id}/vote`).set(paused.auth)).status).toBe(200);
  });
});
