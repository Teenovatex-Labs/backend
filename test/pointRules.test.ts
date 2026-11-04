import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { awardRuleTx, resolveRule } from '../src/lib/pointRules.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const award = (userId: string) => prisma.$transaction((tx) => awardRuleTx(tx, userId, 'lesson', 'test'));

describe('point rules', () => {
  it('uses the built-in value until an admin changes it', async () => {
    const u = await makeUser();
    expect(await award(u.user.id)).toBe(5);
    const admin = await makeUser({ role: 'admin' });
    const res = await request(app).patch('/api/v1/admin/point-rules/lesson').set(admin.auth).send({ points: 2.5 });
    expect(res.status).toBe(200);
    expect(await award(u.user.id)).toBe(2.5);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })).points).toBe(750);
    expect(await prisma.auditLog.count({ where: { action: 'point_rule.update' } })).toBe(1);
  });

  it('trims then stops awards at the daily cap', async () => {
    const u = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    await request(app).patch('/api/v1/admin/point-rules/lesson').set(admin.auth).send({ points: 5, daily_cap: 8 });
    expect(await award(u.user.id)).toBe(5);
    expect(await award(u.user.id)).toBe(3);
    expect(await award(u.user.id)).toBe(0);
  });

  it('resets to the default, rejects bad input, and is admin-only', async () => {
    const admin = await makeUser({ role: 'admin' });
    const mod = await makeUser({ role: 'moderator' });
    const patch = (b: object, who = admin) => request(app).patch('/api/v1/admin/point-rules/lesson').set(who.auth).send(b);
    expect((await patch({ points: 9 }, mod)).status).toBe(403);
    expect((await patch({ points: 1.234 })).status).toBe(400);
    expect((await patch({ points: 5, daily_cap: 2 })).status).toBe(400);
    expect((await request(app).patch('/api/v1/admin/point-rules/nope').set(admin.auth).send({ points: 1 })).status).toBe(404);
    await patch({ points: 9 });
    expect((await patch({ reset: true })).body.points).toBe(5);
    expect((await resolveRule(prisma, 'lesson')).customised).toBe(false);
    const list = await request(app).get('/api/v1/admin/point-rules').set(admin.auth);
    expect(list.body.items).toHaveLength(5);
  });
});
