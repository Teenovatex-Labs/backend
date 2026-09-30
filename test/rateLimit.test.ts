import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { voteLimiter } from '../src/middleware/rateLimiter.js';

// A tiny app that stands in for requireAuth by reading the member from a header.
const buildApp = () => {
  const app = express();
  app.set('trust proxy', 1);
  app.post(
    '/vote',
    (req, _res, next) => {
      (req as { userId?: string }).userId = String(req.headers['x-user']);
      next();
    },
    voteLimiter,
    (_req, res) => res.json({ ok: true })
  );
  return app;
};

beforeAll(() => {
  process.env.TEST_RATE_LIMITS = '1';
});
afterAll(() => {
  delete process.env.TEST_RATE_LIMITS;
});

describe('per-member rate limits', () => {
  it('limits one member without limiting others on the same network', async () => {
    const app = buildApp();
    const sharedNetwork = '203.0.113.50';
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/vote').set('X-Forwarded-For', sharedNetwork).set('x-user', 'member-a');
      expect(res.status).toBe(200);
    }
    const blocked = await request(app).post('/vote').set('X-Forwarded-For', sharedNetwork).set('x-user', 'member-a');
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');

    const other = await request(app).post('/vote').set('X-Forwarded-For', sharedNetwork).set('x-user', 'member-b');
    expect(other.status).toBe(200);
  });
});
