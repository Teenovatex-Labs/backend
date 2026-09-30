import { prisma } from '../db.js';
import { localDay, shiftDay } from './day.js';
import { awardPoints } from './points.js';

const DAILY_POINTS = 3;
const MILESTONE_EVERY = 7;
const MILESTONE_POINTS = 25;

type StreakUser = { id: string; streak: number; last_login_at: Date | null; timezone: string | null };

/**
 * Records that the member showed up today, on their own calendar.
 * Same day: nothing changes. The day after their last visit: the streak grows.
 * Any longer gap: it starts again at 1. Called from every sign-in path.
 */
export const recordDailyLogin = async (user: StreakUser, now: Date = new Date()): Promise<number> => {
  const today = localDay(user.timezone, now);
  const last = user.last_login_at ? localDay(user.timezone, user.last_login_at) : null;

  if (last === today) return user.streak;

  const streak = last === shiftDay(today, -1) ? user.streak + 1 : 1;
  await prisma.user.update({ where: { id: user.id }, data: { last_login_at: now, streak } });

  await awardPoints(user.id, DAILY_POINTS, 'Daily login streak');
  if (streak % MILESTONE_EVERY === 0) {
    await awardPoints(user.id, MILESTONE_POINTS, `${streak}-day streak milestone!`);
  }
  return streak;
};
