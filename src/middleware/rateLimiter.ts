import type { Request } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { config } from '../config.js';
import type { AuthRequest } from './auth.js';

// Tests share one address and one process, so limiting would fail unrelated tests.
// The limiter tests switch it on with TEST_RATE_LIMITS=1 and use their own addresses.
const skipInTests = () => config.env === 'test' && process.env.TEST_RATE_LIMITS !== '1';
const limiter = (options: Partial<Options>) => rateLimit({ skip: skipInTests, ...options });

// For routes behind requireAuth: count per member, not per IP, so people sharing a
// school or mobile network don't trip each other's limits.
const byUser = (req: Request) => (req as AuthRequest).userId ?? req.ip ?? 'unknown';

export const globalLimiter = limiter({
  windowMs: 60_000,
  max: 100,
  message: { error: 'Too many requests', code: 'RATE_LIMITED' },
});

export const voteLimiter = limiter({
  windowMs: 60_000,
  max: 5,
  keyGenerator: byUser,
  message: { error: 'Too many vote requests', code: 'RATE_LIMITED' },
});

// Creating or changing content (projects, avatars): generous for a real person,
// tight enough to stop a script filling the database or the image quota.
export const writeLimiter = limiter({
  windowMs: 10 * 60_000,
  max: 30,
  keyGenerator: byUser,
  message: { error: 'Slow down a little and try again shortly', code: 'RATE_LIMITED' },
});

// Credential-guessing surfaces (login, register) — generous enough for a
// real person mistyping a password a few times, tight enough to make
// brute-forcing impractical.
export const authLimiter = limiter({
  windowMs: 15 * 60_000,
  max: 10,
  message: { error: 'Too many attempts — try again later', code: 'RATE_LIMITED' },
});

// Verifying a 6-digit code (1M possibilities) — the account itself already
// locks after MAX_VERIFICATION_ATTEMPTS, this is the per-IP backstop.
export const otpVerifyLimiter = limiter({
  windowMs: 10 * 60_000,
  max: 15,
  message: { error: 'Too many attempts — request a new code', code: 'RATE_LIMITED' },
});

// Requesting a code/link be sent (resend, forgot-password) — the account
// itself already has a 30s cooldown, this stops someone spraying codes at
// many different addresses to abuse Resend as a spam relay.
export const otpRequestLimiter = limiter({
  windowMs: 10 * 60_000,
  max: 5,
  message: { error: 'Too many requests — try again later', code: 'RATE_LIMITED' },
});

// Contact form — every accepted message sends two emails via Resend, so cap
// it per IP to keep it from being used as a spam relay.
export const contactLimiter = limiter({
  windowMs: 10 * 60_000,
  max: 5,
  message: { error: 'Too many messages — try again in a few minutes', code: 'RATE_LIMITED' },
});
