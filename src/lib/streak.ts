import { prisma } from '../db.js';
import { localDay, shiftDay } from './day.js';
import { awardPoints } from './points.js';
import { createNotification } from './notify.js';
import { checkBadgesQuietly } from './badges.js';

const DAILY_POINTS = 3;
const MILESTONE_EVERY = 7;
const MILESTONE_POINTS = 25;
const MAX_FREEZES = 2;

type StreakUser = { id: string; streak: number; streak_freezes: number; last_login_at: Date | null; timezone: string | null };

/**
 * Records that the member showed up today, on their own calendar.
 * Same day: nothing changes. The day after their last visit: the streak grows.
 * Missed exactly one day but holding a streak freeze: the freeze is spent and the streak carries on.
 * Any longer gap: it starts again at 1. Every 7th day earns a new freeze (up to 2).
 * Called from every sign-in path.
 */
export const recordDailyLogin = async (user: StreakUser, now: Date = new Date()): Promise<number> => {
  const today = localDay(user.timezone, now);
  const last = user.last_login_at ? localDay(user.timezone, user.last_login_at) : null;

  if (last === today) return user.streak;

  const consecutive = last === shiftDay(today, -1);
  const savedByFreeze = !consecutive && last === shiftDay(today, -2) && user.streak > 0 && user.streak_freezes > 0;
  const streak = consecutive || savedByFreeze ? user.streak + 1 : 1;
  const milestone = streak % MILESTONE_EVERY === 0;
  const freezes = Math.min(MAX_FREEZES, user.streak_freezes - (savedByFreeze ? 1 : 0) + (milestone ? 1 : 0));
  await prisma.user.update({ where: { id: user.id }, data: { last_login_at: now, streak, streak_freezes: freezes } });
  if (savedByFreeze) await createNotification(user.id, 'streak', `A streak freeze saved your ${user.streak}-day streak. Nice catch!`, { link: '/home' });

  await awardPoints(user.id, 'streak', DAILY_POINTS, 'Daily login streak');
  if (milestone) {
    await awardPoints(user.id, 'streak_milestone', MILESTONE_POINTS, `${streak}-day streak milestone!`);
  }
  checkBadgesQuietly(user.id);
  return streak;
};
