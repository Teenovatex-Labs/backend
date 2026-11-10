import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { can, type Permission } from '../lib/permissions.js';

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

/** Reads the token if there is a valid one, but lets anonymous visitors through too. */
export const optionalAuth = (req: AuthRequest, _res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const decoded = verifyAccessToken(header.slice(7));
      if (decoded.type === 'access') req.userId = decoded.userId;
    } catch {
      // A bad or expired token on a public page just means "not signed in".
    }
  }
  next();
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

/** The member's role must hold EVERY listed permission. Always place after requireAuth. */
export const requirePermission =
  (...permissions: Permission[]) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });
    if (!user || !permissions.every((p) => can(user.role, p))) {
      res.status(403).json({ error: 'You do not have access to this', code: 'FORBIDDEN' });
      return;
    }
    next();
  };

/**
 * Gate for anything a member does in public (posting, commenting, voting, RSVPing, following).
 * They must have finished onboarding, confirmed their age, chosen a username,
 * and not be suspended. Existing accounts default to active.
 */
export const requireActiveMember = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { birth_date: true, username_set: true, membership_status: true, suspended_until: true, suspended_reason: true },
  });
  if (!user?.birth_date) {
    res.status(403).json({ error: 'Please confirm your date of birth first', code: 'AGE_REQUIRED' });
    return;
  }
  if (!user.username_set) {
    res.status(403).json({ error: 'Please choose a username first', code: 'USERNAME_REQUIRED' });
    return;
  }
  if (user.membership_status !== 'active') {
    res.status(403).json({
      error: user.membership_status === 'onboarding' ? 'Finish your first week setup before joining in' : 'Your membership is not active right now',
      code: user.membership_status === 'onboarding' ? 'ONBOARDING_REQUIRED' : 'MEMBERSHIP_INACTIVE',
    });
    return;
  }
  if (user.suspended_until && user.suspended_until.getTime() > Date.now()) {
    res.status(403).json({
      error: `Your account is paused until ${user.suspended_until.toISOString().slice(0, 10)}. You can still read, but you can't post or vote for now.`,
      code: 'ACCOUNT_SUSPENDED',
      suspended_until: user.suspended_until.toISOString(),
    });
    return;
  }
  next();
};

/** Older name, kept so existing routes keep working. */
export const requireAgeConfirmed = requireActiveMember;
