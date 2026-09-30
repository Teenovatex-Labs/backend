import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgresql://x', NODE_ENV: 'production' };
const good = {
  ...base,
  JWT_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  FRONTEND_URL: 'https://app.teenovatex.org,https://www.teenovatex.org',
};

describe('server configuration', () => {
  it('accepts a complete production environment and splits the CORS list', () => {
    const c = parseConfig(good);
    expect(c.isProduction).toBe(true);
    expect(c.allowedOrigins).toEqual(['https://app.teenovatex.org', 'https://www.teenovatex.org']);
  });

  it('refuses to start in production without JWT secrets', () => {
    expect(() => parseConfig({ ...base, FRONTEND_URL: 'https://x.org' })).toThrow(/JWT_SECRET/);
  });

  it('refuses short secrets', () => {
    expect(() => parseConfig({ ...good, JWT_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('refuses identical access and refresh secrets', () => {
    expect(() => parseConfig({ ...good, JWT_REFRESH_SECRET: good.JWT_SECRET })).toThrow(/must be different/);
  });

  it('refuses to start in production without an allowed-origins list (no wildcard fallback)', () => {
    const { FRONTEND_URL: _omit, ...withoutOrigins } = good;
    expect(() => parseConfig(withoutOrigins)).toThrow(/FRONTEND_URL/);
  });

  it('gives development clearly-labelled secrets so local work needs no setup', () => {
    const c = parseConfig({ DATABASE_URL: 'postgresql://x', NODE_ENV: 'development' });
    expect(c.jwt.access).toContain('dev-only');
    expect(c.allowedOrigins).toContain('http://localhost:3000');
  });
});
