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
