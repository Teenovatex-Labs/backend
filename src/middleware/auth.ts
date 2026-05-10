import type { Request, Response, NextFunction } from 'express';
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
