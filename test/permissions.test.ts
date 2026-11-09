import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@prisma/client';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { can, permissionsFor, type Permission } from '../src/lib/permissions.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

// What moderators and admins could do on main before the permissions map existed.
const STAFF: Permission[] = [
  'staff.access', 'reports.read', 'reports.resolve', 'users.read', 'users.suspend', 'audit.read',
  'attachments.review', 'events.manage', 'announcements.manage', 'learn.manage', 'analytics.read',
];
const ADMIN_ONLY: Permission[] = [
  'users.set_role', 'settings.manage', 'applications.review', 'applications.window', 'membership.manage',
  'points.manage', 'badges.manage', 'badges.award', 'challenges.manage', 'challenges.judge', 'pairing.manage',
];

describe('can(role, permission)', () => {
  const roles: Role[] = ['member', 'mentor', 'moderator', 'admin', 'tutor', 'partner'];
  const all = [...STAFF, ...ADMIN_ONLY];

  it.each(roles)('gives %s exactly the expected permissions', (role) => {
    const expected = role === 'admin' ? all : role === 'moderator' ? STAFF : [];
    for (const p of all) expect(can(role, p), `${role} / ${p}`).toBe(expected.includes(p));
    expect([...permissionsFor(role)].sort()).toEqual([...expected].sort());
  });
});

describe('requirePermission on real routes', () => {
  it('lets moderators run staff routes but not set roles', async () => {
    const mod = await makeUser({ role: 'moderator' });
    const target = await makeUser();
    expect((await request(app).get('/api/v1/admin/reports').set(mod.auth)).status).toBe(200);
    expect((await request(app).post(`/api/v1/admin/users/${target.user.id}/role`).set(mod.auth).send({ role: 'mentor' })).status).toBe(403);
  });

  it('keeps ordinary members out of staff routes', async () => {
    const member = await makeUser();
    expect((await request(app).get('/api/v1/admin/reports').set(member.auth)).status).toBe(403);
  });
});

describe('GET /users/me', () => {
  it('returns the permissions the role holds', async () => {
    const admin = await makeUser({ role: 'admin' });
    const member = await makeUser();
    const a = await request(app).get('/api/v1/users/me').set(admin.auth);
    const m = await request(app).get('/api/v1/users/me').set(member.auth);
    expect(a.body.permissions).toContain('applications.review');
    expect(m.body.permissions).toEqual([]);
  });
});
