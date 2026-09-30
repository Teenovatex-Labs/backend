import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const setup = async () => {
  const mod = await makeUser({ role: 'moderator' });
  const admin = await makeUser({ role: 'admin' });
  const bad = await makeUser();
  const reporter = await makeUser();
  const space = await prisma.space.create({ data: { slug: 'general', name: 'General', description: 'x' } });
  const post = await prisma.post.create({ data: { space_id: space.id, author_id: bad.user.id, title: 'Rude', body: 'something unkind' } });
  await request(app).post('/api/v1/reports').set(reporter.auth).send({ target_type: 'post', target_id: post.id, reason: 'bullying' });
  const report = await prisma.report.findFirstOrThrow();
  return { mod, admin, bad, reporter, post, report };
};

describe('admin access', () => {
  it('is closed to members and signed-out visitors', async () => {
    const member = await makeUser();
    for (const path of ['/stats', '/reports', '/users', '/audit']) {
      expect((await request(app).get(`/api/v1/admin${path}`).set(member.auth)).status).toBe(403);
      expect((await request(app).get(`/api/v1/admin${path}`)).status).toBe(401);
    }
  });
});

describe('the report queue', () => {
  it('shows what a moderator needs to decide', async () => {
    const { mod } = await setup();
    const res = await request(app).get('/api/v1/admin/reports').set(mod.auth);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      target_type: 'post',
      reason: 'bullying',
      status: 'open',
      target: { exists: true, title: 'Rude', excerpt: 'something unkind' },
      reports_on_target: 1,
      reports_on_member: 1,
    });
  });

  it('puts self-harm reports first', async () => {
    const { mod, bad, reporter } = await setup();
    const space = await prisma.space.findFirstOrThrow();
    const worrying = await prisma.post.create({ data: { space_id: space.id, author_id: bad.user.id, title: 'Sad', body: 'not ok' } });
    await request(app).post('/api/v1/reports').set(reporter.auth).send({ target_type: 'post', target_id: worrying.id, reason: 'self_harm' });
    const res = await request(app).get('/api/v1/admin/reports').set(mod.auth);
    expect(res.body.items[0].reason).toBe('self_harm');
  });

  it('dismisses a report and records it', async () => {
    const { mod, report, post } = await setup();
    const res = await request(app).post(`/api/v1/admin/reports/${report.id}/resolve`).set(mod.auth).send({ action: 'dismiss', note: 'Fine' });
    expect(res.status).toBe(200);
    expect((await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).status).toBe('dismissed');
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).hidden).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: 'report.dismiss' } })).toBe(1);
  });

  it('removes content, closes every report on it, tells the author, and audits it', async () => {
    const { mod, report, post, bad, reporter } = await setup();
    const other = await makeUser();
    await request(app).post('/api/v1/reports').set(other.auth).send({ target_type: 'post', target_id: post.id, reason: 'spam' });

    const res = await request(app).post(`/api/v1/admin/reports/${report.id}/resolve`).set(mod.auth).send({ action: 'remove', note: 'Unkind' });
    expect(res.status).toBe(200);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).hidden).toBe(true);
    expect(await prisma.report.count({ where: { status: 'actioned' } })).toBe(2);
    const note = await prisma.notification.findFirstOrThrow({ where: { user_id: bad.user.id, type: 'moderation' } });
    expect(note.message).toMatch(/removed/i);
    expect(reporter.user.id).not.toBe(bad.user.id);

    const again = await request(app).post(`/api/v1/admin/reports/${report.id}/resolve`).set(mod.auth).send({ action: 'dismiss' });
    expect(again.status).toBe(409);
  });

  it('suspends the author from a report', async () => {
    const { mod, report, bad } = await setup();
    expect((await request(app).post(`/api/v1/admin/reports/${report.id}/resolve`).set(mod.auth).send({ action: 'suspend' })).status).toBe(400);
    const ok = await request(app).post(`/api/v1/admin/reports/${report.id}/resolve`).set(mod.auth).send({ action: 'suspend', days: 7, note: 'Bullying' });
    expect(ok.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: bad.user.id } });
    expect(user.suspended_until!.getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
    expect(user.suspended_reason).toBe('Bullying');
  });
});

describe('members', () => {
  it('lets a moderator suspend and unsuspend a member, with an audit trail', async () => {
    const { mod, bad } = await setup();
    expect((await request(app).post(`/api/v1/admin/users/${bad.user.id}/suspend`).set(mod.auth).send({ days: 3, reason: 'Spamming' })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bad.user.id } })).suspended_until).not.toBeNull();
    await request(app).post(`/api/v1/admin/users/${bad.user.id}/unsuspend`).set(mod.auth);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bad.user.id } })).suspended_until).toBeNull();

    const log = await request(app).get('/api/v1/admin/audit').set(mod.auth);
    expect(log.body.items.map((i: { action: string }) => i.action)).toEqual(expect.arrayContaining(['user.suspend', 'user.unsuspend']));
    expect(log.body.items[0].actor).toBe(mod.user.username);
  });

  it('stops a moderator acting on staff or themselves, but not an admin', async () => {
    const { mod, admin } = await setup();
    expect((await request(app).post(`/api/v1/admin/users/${admin.user.id}/suspend`).set(mod.auth).send({ days: 1, reason: 'test test' })).status).toBe(403);
    expect((await request(app).post(`/api/v1/admin/users/${mod.user.id}/suspend`).set(mod.auth).send({ days: 1, reason: 'test test' })).status).toBe(400);
    const other = await makeUser({ role: 'moderator' });
    expect((await request(app).post(`/api/v1/admin/users/${other.user.id}/suspend`).set(admin.auth).send({ days: 1, reason: 'test test' })).status).toBe(200);
  });

  it('lets only admins change roles, and never their own', async () => {
    const { mod, admin, bad } = await setup();
    expect((await request(app).post(`/api/v1/admin/users/${bad.user.id}/role`).set(mod.auth).send({ role: 'moderator' })).status).toBe(403);
    expect((await request(app).post(`/api/v1/admin/users/${bad.user.id}/role`).set(admin.auth).send({ role: 'moderator' })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bad.user.id } })).role).toBe('moderator');
    expect((await request(app).post(`/api/v1/admin/users/${admin.user.id}/role`).set(admin.auth).send({ role: 'member' })).status).toBe(400);
  });

  it('searches members and shows how many reports each has', async () => {
    const { mod, bad } = await setup();
    const res = await request(app).get(`/api/v1/admin/users?search=${bad.user.username}`).set(mod.auth);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].reports_against).toBe(1);
  });

  it('reports headline numbers', async () => {
    const { mod } = await setup();
    const res = await request(app).get('/api/v1/admin/stats').set(mod.auth);
    expect(res.body).toMatchObject({ users: 4, open_reports: 1, posts: 1, suspended: 0 });
  });
});

describe('labs are filtered too', () => {
  it('refuses a lab whose text breaks the rules', async () => {
    const me = await makeUser({ created_at: new Date(Date.now() - 30 * 86400000) });
    const res = await request(app).post('/api/v1/projects').set(me.auth).field('name', 'Cool thing').field('short_description', 'call 0803 555 1234').field('description', 'A great description here').field('category', 'web');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PERSONAL_INFO');
    expect(await prisma.project.count()).toBe(0);
    void makeProject;
  });
});
