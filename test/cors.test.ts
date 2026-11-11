import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { config, parseConfig } from '../src/config.js';

describe('CORS configuration and origin handling', () => {
  const originalOrigins = [...config.allowedOrigins];

  afterAll(() => {
    config.allowedOrigins.length = 0;
    config.allowedOrigins.push(...originalOrigins);
  });

  describe('FRONTEND_URL parsing in parseConfig', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://x',
      NODE_ENV: 'production' as const,
      JWT_SECRET: 'a'.repeat(40),
      JWT_REFRESH_SECRET: 'b'.repeat(40),
    };

    it('splits comma-separated origins, trims whitespace, and ignores empty entries', () => {
      const parsed = parseConfig({
        ...baseEnv,
        FRONTEND_URL: '  https://app.teenovatex.org , https://www.teenovatex.org , , https://admin.teenovatex.org  ',
      });
      expect(parsed.allowedOrigins).toEqual([
        'https://app.teenovatex.org',
        'https://www.teenovatex.org',
        'https://admin.teenovatex.org',
      ]);
    });

    it('handles 5 configured origins correctly', () => {
      const fiveOrigins = [
        'https://teenovatex.org',
        'https://app.teenovatex.org',
        'https://admin.teenovatex.org',
        'https://tutors.teenovatex.org',
        'https://partners.teenovatex.org',
      ];
      const parsed = parseConfig({
        ...baseEnv,
        FRONTEND_URL: fiveOrigins.join(','),
      });
      expect(parsed.allowedOrigins).toHaveLength(5);
      expect(parsed.allowedOrigins).toEqual(fiveOrigins);
    });
  });

  describe('CORS middleware behaviour on HTTP requests', () => {
    const fiveOrigins = [
      'https://teenovatex.org',
      'https://app.teenovatex.org',
      'https://admin.teenovatex.org',
      'https://tutors.teenovatex.org',
      'https://partners.teenovatex.org',
    ];

    beforeEach(() => {
      config.allowedOrigins.length = 0;
      config.allowedOrigins.push(...fiveOrigins);
    });

    it('accepts every origin when 5 origins are configured (acceptance case: GET and OPTIONS)', async () => {
      expect(config.allowedOrigins).toHaveLength(5);

      for (const origin of fiveOrigins) {
        // Preflight OPTIONS request
        const preflight = await request(app)
          .options('/health')
          .set('Origin', origin)
          .set('Access-Control-Request-Method', 'GET');

        expect(preflight.status).toBe(204);
        expect(preflight.headers['access-control-allow-origin']).toBe(origin);
        expect(preflight.headers['access-control-allow-credentials']).toBe('true');

        // Simple GET request
        const res = await request(app).get('/health').set('Origin', origin);
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe(origin);
        expect(res.headers['access-control-allow-credentials']).toBe('true');
      }
    });

    it('rejects an unknown origin by withstanding Access-Control-Allow-Origin header', async () => {
      const unknownOrigins = [
        'https://evil.example.com',
        'https://attacker.org',
        'http://localhost:9999',
        'https://unregistered.teenovatex.org',
      ];

      for (const origin of unknownOrigins) {
        // Preflight OPTIONS request
        const preflight = await request(app)
          .options('/health')
          .set('Origin', origin)
          .set('Access-Control-Request-Method', 'GET');

        expect(preflight.headers['access-control-allow-origin']).toBeUndefined();

        // Simple GET request
        const res = await request(app).get('/health').set('Origin', origin);
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      }
    });

    it('dynamically adapts when origins are loaded from a comma-separated list', async () => {
      const rawFrontendUrl = ' https://custom-one.org , https://custom-two.org ';
      const parsedOrigins = rawFrontendUrl.split(',').map((o) => o.trim()).filter(Boolean);

      config.allowedOrigins.length = 0;
      config.allowedOrigins.push(...parsedOrigins);

      const res1 = await request(app).get('/health').set('Origin', 'https://custom-one.org');
      expect(res1.headers['access-control-allow-origin']).toBe('https://custom-one.org');

      const res2 = await request(app).get('/health').set('Origin', 'https://custom-two.org');
      expect(res2.headers['access-control-allow-origin']).toBe('https://custom-two.org');

      const blocked = await request(app).get('/health').set('Origin', 'https://teenovatex.org');
      expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});

