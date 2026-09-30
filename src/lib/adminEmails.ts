import { config } from '../config.js';
import { prisma } from '../db.js';
import { audit } from './audit.js';

/**
 * Makes someone an admin if their email is on the ADMIN_EMAILS list. Only call this once the address
 * has been proven to be theirs (email code or Google), so nobody can get admin by typing an email.
 */
export const promoteIfAdminEmail = async (user: { id: string; email: string; role: string }): Promise<boolean> => {
  if (user.role === 'admin' || !config.adminEmails.includes(user.email.toLowerCase())) return false;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { role: 'admin' } });
    await audit(null, 'user.role', { type: 'user', id: user.id }, { from: user.role, to: 'admin', via: 'ADMIN_EMAILS' }, tx);
  });
  return true;
};
