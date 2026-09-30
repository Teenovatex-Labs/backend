import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { prisma } from '../db.js';
import { config } from '../config.js';

const ACCESS_SECRET = config.jwt.access;
const REFRESH_SECRET = config.jwt.refresh;
// Password-reset tokens get their own key, derived from the access secret, so a
// reset token can never be replayed as an access token or the other way round.
const RESET_SECRET = crypto.createHmac('sha256', ACCESS_SECRET).update('password-reset').digest('hex');

export const generateAccessToken = (userId: string) =>
  jwt.sign({ userId, type: 'access' }, ACCESS_SECRET, { expiresIn: '15m' });

export const generateRefreshToken = (userId: string) =>
  // jwtid makes every token unique; without it two sign-ins in the same second
  // produce identical tokens and collide on the session's unique token_hash.
  jwt.sign({ userId, type: 'refresh' }, REFRESH_SECRET, { expiresIn: '7d', jwtid: crypto.randomUUID() });

/**
 * The refresh token a session holds after its Nth rotation. It is a pure function of the session
 * (id, rotation count, rotation time), so the server can hand out the very same token again to
 * anyone who presents the one before it. That makes rotation safe when a response is lost or two
 * tabs refresh at once, while a copied old token used later is still caught.
 */
export const deriveRefreshToken = (s: { id: string; user_id: string; rotation: number; rotated_at: Date }) =>
  jwt.sign({ userId: s.user_id, type: 'refresh', iat: Math.floor(s.rotated_at.getTime() / 1000) }, REFRESH_SECRET, {
    expiresIn: '7d',
    jwtid: crypto.createHmac('sha256', REFRESH_SECRET).update(`${s.id}:${s.rotation}`).digest('hex').slice(0, 32),
  });

export const generateResetToken = (userId: string) =>
  jwt.sign({ userId, type: 'reset' }, RESET_SECRET, { expiresIn: '15m' });

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, ACCESS_SECRET) as { userId: string; type: string };

export const verifyResetToken = (token: string) =>
  jwt.verify(token, RESET_SECRET) as { userId: string; type: string };

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, REFRESH_SECRET) as { userId: string; type: string };

export const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

export const createSession = async (userId: string, req: Request) => {
  const access_token = generateAccessToken(userId);
  const refresh_token = generateRefreshToken(userId);
  const token_hash = hashToken(refresh_token);

  // A session that hasn't refreshed for 8 days has an expired token (they last 7), so it can never be used again.
  await prisma.session.deleteMany({
    where: { user_id: userId, last_active: { lt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } },
  });

  await prisma.session.create({
    data: {
      user_id: userId,
      token_hash,
      device_info: (req.headers['user-agent'] as string | undefined) ?? null,
      ip: req.ip ?? null,
    },
  });

  return { access_token, refresh_token };
};
