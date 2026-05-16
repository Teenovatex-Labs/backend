import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/tokens.js';
import { prisma } from '../db.js';
import { asyncHandler } from './error.js';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export const requireAuth = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
    
    // Strict check for banned users
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, banned: true },
    });

    if (!user) {
      res.status(401).json({ error: 'User not found', code: 'UNAUTHORIZED' });
      return;
    }
    if (user.banned) {
      res.status(403).json({ error: 'Account is banned', code: 'BANNED' });
      return;
    }

    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
});

/**
 * requireAdmin — must be chained after requireAuth.
 * Looks up the authenticated user and checks role === 'admin'.
 * Returns 403 if the user is not an admin.
 */
export const requireAdmin = asyncHandler(async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { role: true },
  });

  if (!user || user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required', code: 'FORBIDDEN' });
    return;
  }

  req.userRole = user.role;
  next();
});
