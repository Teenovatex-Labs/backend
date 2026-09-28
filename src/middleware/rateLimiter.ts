import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  message: { error: 'Too many requests', code: 'RATE_LIMITED' },
});

export const voteLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  message: { error: 'Too many vote requests', code: 'RATE_LIMITED' },
});

// Credential-guessing surfaces (login, register) — generous enough for a
// real person mistyping a password a few times, tight enough to make
// brute-forcing impractical.
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  message: { error: 'Too many attempts — try again later', code: 'RATE_LIMITED' },
});

// Verifying a 6-digit code (1M possibilities) — the account itself already
// locks after MAX_VERIFICATION_ATTEMPTS, this is the per-IP backstop.
export const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 15,
  message: { error: 'Too many attempts — request a new code', code: 'RATE_LIMITED' },
});

// Requesting a code/link be sent (resend, forgot-password) — the account
// itself already has a 30s cooldown, this stops someone spraying codes at
// many different addresses to abuse Resend as a spam relay.
export const otpRequestLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 5,
  message: { error: 'Too many requests — try again later', code: 'RATE_LIMITED' },
});
