import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import {
  createSession,
  hashToken,
  verifyRefreshToken,
  generateAccessToken,
  generateResetToken,
} from '../lib/tokens.js';
import { awardPoints } from '../lib/points.js';
import { sendPasswordResetEmail } from '../lib/email.js';

export const register = async (req: Request, res: Response): Promise<void> => {
  const { full_name, username, email, password } = req.body as {
    full_name: string;
    username: string;
    email: string;
    password: string;
  };

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });
  if (existing) {
    const field = existing.email === email ? 'Email' : 'Username';
    res.status(400).json({ error: `${field} already in use`, code: 'DUPLICATE' });
    return;
  }

  const password_hash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { full_name, username, email, password_hash, settings: { create: {} } },
  });

  const tokens = await createSession(user.id, req);

  res.status(201).json({
    message: 'Registration successful',
    user: { id: user.id, username: user.username, email: user.email },
    ...tokens,
  });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email: string; password: string };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    return;
  }

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  let newStreak = 1;
  let streakPoints = 3;

  if (user.last_login_at) {
    const last = new Date(user.last_login_at);
    if (last.toDateString() === now.toDateString()) {
      newStreak = user.streak;
      streakPoints = 0;
    } else if (last.toDateString() === yesterday.toDateString()) {
      newStreak = user.streak + 1;
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { last_login_at: now, streak: newStreak },
  });

  if (streakPoints > 0) {
    await awardPoints(user.id, streakPoints, 'Daily login streak');
    if (newStreak > 0 && newStreak % 7 === 0) {
      await awardPoints(user.id, 25, `${newStreak}-day streak milestone!`);
    }
  }

  const tokens = await createSession(user.id, req);

  res.json({
    ...tokens,
    user: { id: user.id, username: user.username, avatar_url: user.avatar_url },
  });
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  const { refresh_token } = req.body as { refresh_token: string };

  let decoded: { userId: string; type: string };
  try {
    decoded = verifyRefreshToken(refresh_token);
  } catch {
    res.status(401).json({ error: 'Invalid refresh token', code: 'INVALID_TOKEN' });
    return;
  }

  if (decoded.type !== 'refresh') {
    res.status(401).json({ error: 'Invalid token type', code: 'INVALID_TOKEN' });
    return;
  }

  const token_hash = hashToken(refresh_token);
  const session = await prisma.session.findUnique({ where: { token_hash } });
  if (!session) {
    res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' });
    return;
  }

  await prisma.session.update({ where: { id: session.id }, data: { last_active: new Date() } });

  res.json({ access_token: generateAccessToken(decoded.userId) });
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body as { email: string };
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const token = generateResetToken(user.id);
    await sendPasswordResetEmail(email, token);
  }

  res.json({ message: 'If that email is registered, a reset link has been sent' });
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const { token, new_password } = req.body as { token: string; new_password: string };

  let decoded: { userId: string; type: string };
  try {
    const { verifyAccessToken } = await import('../lib/tokens.js');
    decoded = verifyAccessToken(token);
  } catch {
    res.status(400).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
    return;
  }

  if (decoded.type !== 'reset') {
    res.status(400).json({ error: 'Invalid token type', code: 'INVALID_TOKEN' });
    return;
  }

  const password_hash = await bcrypt.hash(new_password, 12);
  await prisma.user.update({ where: { id: decoded.userId }, data: { password_hash } });
  await prisma.session.deleteMany({ where: { user_id: decoded.userId } });

  res.json({ message: 'Password updated successfully' });
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { refresh_token?: string };
  if (body.refresh_token) {
    const token_hash = hashToken(body.refresh_token);
    await prisma.session.deleteMany({ where: { token_hash } });
  }
  res.json({ message: 'Logged out' });
};
