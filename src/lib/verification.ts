import crypto from 'crypto';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds between sends
const MAX_ATTEMPTS = 5;

export const generateVerificationCode = (): string =>
  crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

// Bound to the user id so a leaked hash from one row can't be replayed
// against another; a plain SHA-256 (not bcrypt) is fine here since the
// secret space is only 10^6 and the field is short-lived and attempt-limited.
export const hashVerificationCode = (code: string, userId: string): string =>
  crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');

export const verificationExpiry = (): Date => new Date(Date.now() + CODE_TTL_MS);

export const isVerificationExpired = (expiresAt: Date | null): boolean =>
  !expiresAt || expiresAt.getTime() < Date.now();

// A code is still within its resend cooldown if more than (TTL - cooldown)
// of its lifetime remains, i.e. it was issued less than `cooldown` ago.
export const isWithinResendCooldown = (expiresAt: Date | null): boolean =>
  !!expiresAt && expiresAt.getTime() - Date.now() > CODE_TTL_MS - RESEND_COOLDOWN_MS;

export const secondsUntilResendAllowed = (expiresAt: Date | null): number => {
  if (!expiresAt) return 0;
  const allowedAt = expiresAt.getTime() - (CODE_TTL_MS - RESEND_COOLDOWN_MS);
  return Math.max(0, Math.ceil((allowedAt - Date.now()) / 1000));
};

export const MAX_VERIFICATION_ATTEMPTS = MAX_ATTEMPTS;
