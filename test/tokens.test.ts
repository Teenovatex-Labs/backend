import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { generateAccessToken, generateResetToken, verifyAccessToken, verifyResetToken } from '../src/lib/tokens.js';

describe('tokens', () => {
  it('a reset token can never be used as an access token', () => {
    const reset = generateResetToken('user-1');
    expect(() => verifyAccessToken(reset)).toThrow();
    expect(verifyResetToken(reset).type).toBe('reset');
  });

  it('an access token can never be used to reset a password', () => {
    expect(() => verifyResetToken(generateAccessToken('user-1'))).toThrow();
  });

  it('rejects tokens signed with the old hard-coded fallback secret', () => {
    const forged = jwt.sign({ userId: 'user-1', type: 'access' }, 'access-secret');
    expect(() => verifyAccessToken(forged)).toThrow();
  });
});
