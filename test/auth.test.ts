import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@prisma/client';

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    async verifyIdToken({ idToken }: { idToken: string }) {
      const [sub, email] = idToken.split('|');
      return { getPayload: () => ({ sub, email, email_verified: true, name: 'Google User' }) };
    }
  },
}));

import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { permissionsFor } from '../src/lib/permissions.js';
import { createSession } from '../src/lib/tokens.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

const roles: Role[] = ['member', 'moderator', 'tutor', 'partner'];

beforeEach(async () => {
  await resetDb();
  config.googleClientId = 'test-client';
  config.requireInvitation = false;
  config.adminEmails = [];
});

afterAll(async () => {
  await prisma.$disconnect();
});

const assertAuthPayload = (body: any, expectedUser: { id: string; username: string; avatar_url: string | null; role: Role }) => {
  expect(body.access_token).toBeTruthy();
  expect(body.refresh_token).toBeTruthy();

  // Existing user fields
  expect(body.user).toBeDefined();
  expect(body.user.id).toBe(expectedUser.id);
  expect(body.user.username).toBe(expectedUser.username);
  expect(body.user.avatar_url).toBe(expectedUser.avatar_url);

  // New role and permissions fields
  expect(body.user.role).toBe(expectedUser.role);
  expect(body.user.permissions).toEqual(permissionsFor(expectedUser.role));

  // Role and permissions must not be in the JWT payload
  const accessDecoded = jwt.decode(body.access_token) as Record<string, unknown>;
  expect(accessDecoded.role).toBeUndefined();
  expect(accessDecoded.permissions).toBeUndefined();

  const refreshDecoded = jwt.decode(body.refresh_token) as Record<string, unknown>;
  expect(refreshDecoded.role).toBeUndefined();
  expect(refreshDecoded.permissions).toBeUndefined();
};

describe('POST /api/v1/auth/login role and permissions', () => {
  it.each(roles)('returns role and permissions for %s, keeping existing fields and clean JWT', async (role) => {
    const password = 'Password123!';
    const password_hash = await bcrypt.hash(password, 4);
    const { user } = await makeUser({ role, password_hash });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password });

    expect(res.status).toBe(200);
    assertAuthPayload(res.body, user);
  });
});

describe('POST /api/v1/auth/google role and permissions', () => {
  it.each(roles)('returns role and permissions for %s, keeping existing fields and clean JWT', async (role) => {
    const google_id = `google_${role}_${Math.random().toString(36).slice(2, 8)}`;
    const { user } = await makeUser({ role, google_id });

    const res = await request(app)
      .post('/api/v1/auth/google')
      .send({ id_token: `${google_id}|${user.email}` });

    expect(res.status).toBe(200);
    assertAuthPayload(res.body, user);
  });
});

describe('POST /api/v1/auth/refresh role and permissions', () => {
  it.each(roles)('returns role and permissions for %s, keeping existing fields and clean JWT', async (role) => {
    const { user } = await makeUser({ role });
    const tokens = await createSession(user.id, { headers: {}, ip: '127.0.0.1' } as never);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: tokens.refresh_token });

    expect(res.status).toBe(200);
    assertAuthPayload(res.body, user);
  });

  it('returns role and permissions when refreshing within the grace period', async () => {
    const { user } = await makeUser({ role: 'moderator' });
    const tokens = await createSession(user.id, { headers: {}, ip: '127.0.0.1' } as never);

    // Initial rotation
    const firstRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: tokens.refresh_token });
    expect(firstRefresh.status).toBe(200);

    // Replay within grace period
    const graceRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: tokens.refresh_token });
    expect(graceRefresh.status).toBe(200);
    assertAuthPayload(graceRefresh.body, user);
  });
});

