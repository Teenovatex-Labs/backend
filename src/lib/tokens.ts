import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { prisma } from '../db.js';

const ACCESS_SECRET = process.env.JWT_SECRET ?? 'access-secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'refresh-secret';

export const generateAccessToken = (userId: string) =>
  jwt.sign({ userId, type: 'access' }, ACCESS_SECRET, { expiresIn: '15m' });

export const generateRefreshToken = (userId: string) =>
  jwt.sign({ userId, type: 'refresh' }, REFRESH_SECRET, { expiresIn: '7d' });

export const generateResetToken = (userId: string) =>
  jwt.sign({ userId, type: 'reset' }, ACCESS_SECRET, { expiresIn: '15m' });

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, ACCESS_SECRET) as { userId: string; type: string };

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
