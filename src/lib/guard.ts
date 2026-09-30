import { prisma } from '../db.js';
import { HttpError } from './errors.js';
import { accountAgeDays, screenText } from './contentFilter.js';
import { audit } from './audit.js';

/**
 * Runs the content filter over everything a member is about to publish and refuses (422) with a
 * message they can act on. A self-harm hit leaves a line in the audit log so a moderator can
 * check in on them; nothing they wrote is stored.
 */
export const assertClean = async (userId: string, texts: (string | null | undefined)[], opts: { allowLinks?: boolean } = {}) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { created_at: true } });
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');
  const age = accountAgeDays(user.created_at);

  for (const text of texts) {
    if (!text) continue;
    const result = screenText(text, { accountAgeDays: age, allowLinks: opts.allowLinks });
    if (!result.ok) {
      if (result.code === 'SELF_HARM') await audit(userId, 'filter.self_harm', { type: 'user', id: userId });
      throw new HttpError(422, result.code, result.message);
    }
  }
};
