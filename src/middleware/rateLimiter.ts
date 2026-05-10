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
