import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { verifyAccessToken } from '../lib/tokens.js';

export interface AuthRequest extends Request {
  userId?: string;
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }
  try {
    const decoded = verifyAccessToken(header.slice(7));
    if (decoded.type !== 'access') {
      res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
      return;
    }
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
};

/** Only members whose role is one of `roles` may continue. Always place after requireAuth. */
export const requireRole =
  (...roles: Role[]) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: 'You do not have access to this', code: 'FORBIDDEN' });
      return;
    }
    next();
  };

/** Posting, voting and other public actions wait until the member has confirmed their age. */
export const requireAgeConfirmed = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { birth_date: true, username_set: true } });
  if (!user?.birth_date) {
    res.status(403).json({ error: 'Please confirm your date of birth first', code: 'AGE_REQUIRED' });
    return;
  }
  if (!user.username_set) {
    res.status(403).json({ error: 'Please choose a username first', code: 'USERNAME_REQUIRED' });
    return;
  }
  next();
};
