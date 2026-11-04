import type { Application } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';
import { hashToken } from '../lib/tokens.js';

export interface ApplicantRequest extends Request {
  application?: Application;
}

/**
 * Applicants have no account. They prove who they are with the emailed link's token, sent as
 * `Authorization: Bearer <token>`. Using it also proves they own the email address.
 */
export const requireApplicant = async (req: ApplicantRequest, res: Response, next: NextFunction): Promise<void> => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const found = token
    ? await prisma.application.findUnique({ where: { resume_token_hash: hashToken(token) } })
    : null;
  if (!found || !found.resume_expires_at || found.resume_expires_at < new Date()) {
    res.status(401).json({ error: 'This link has expired. Ask for a new one.', code: 'LINK_EXPIRED' });
    return;
  }
  req.application = found.email_verified_at
    ? found
    : await prisma.application.update({ where: { id: found.id }, data: { email_verified_at: new Date() } });
  next();
};
