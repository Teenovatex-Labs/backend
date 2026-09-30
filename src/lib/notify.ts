import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { publish } from './realtime.js';

type NotifyOptions = { link?: string; payload?: Prisma.InputJsonValue };

/** Types a member can switch off in Settings. Anything else is always delivered. */
const MUTABLE_BY_SETTING: Record<string, 'vote_alerts' | 'contest_updates'> = {
  vote: 'vote_alerts',
  contest: 'contest_updates',
};

export const createNotification = async (
  userId: string,
  type: string,
  message: string,
  options: NotifyOptions = {}
) => {
  const setting = MUTABLE_BY_SETTING[type];
  if (setting) {
    const settings = await prisma.userSettings.findUnique({ where: { user_id: userId } });
    if (settings && settings[setting] === false) return null;
  }
  const created = await prisma.notification.create({
    data: {
      user_id: userId,
      type,
      message,
      link: options.link ?? null,
      ...(options.payload !== undefined && { payload: options.payload }),
    },
  });
  publish(userId, { type: 'notification' });
  return created;
};
