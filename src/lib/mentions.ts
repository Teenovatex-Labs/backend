import { prisma } from '../db.js';
import { createNotification } from './notify.js';
import { blockedEitherWay } from '../controllers/safety.js';

const MAX_MENTIONS = 5;

/** Usernames written as @name in some text, in order, without repeats. */
export const extractMentions = (text: string): string[] => {
  const found = new Map<string, string>();
  for (const m of text.matchAll(/(?:^|[^\w@])@([a-zA-Z0-9_]{3,30})\b/g)) found.set(m[1]!.toLowerCase(), m[1]!);
  return [...found.values()];
};

/**
 * Tells members they were mentioned. At most 5 people per piece of text, never yourself, and never
 * anyone who has blocked you (or whom you blocked), so a mention can't be used to reach someone
 * who asked not to be reached.
 */
export async function notifyMentions(authorId: string, text: string, where: { what: string; link: string }): Promise<number> {
  const names = extractMentions(text).slice(0, MAX_MENTIONS);
  if (names.length === 0) return 0;
  const [author, hidden, targets] = await Promise.all([
    prisma.user.findUnique({ where: { id: authorId }, select: { username: true } }),
    blockedEitherWay(authorId),
    prisma.user.findMany({ where: { username: { in: names, mode: 'insensitive' } }, select: { id: true } }),
  ]);
  let sent = 0;
  for (const t of targets) {
    if (t.id === authorId || hidden.includes(t.id)) continue;
    await createNotification(t.id, 'mention', `@${author?.username} mentioned you ${where.what}`, { link: where.link });
    sent++;
  }
  return sent;
}
