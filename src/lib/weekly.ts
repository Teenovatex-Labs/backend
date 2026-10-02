import { prisma } from '../db.js';
import { dayToDb, localDay, nextLocalMidnight, shiftDay } from './day.js';

// Three bigger goals each week, the same for everyone, picked by the calendar. A week runs Monday to
// Sunday on the member's own clock. Progress is counted from real activity inside that week, so it
// can't be faked, and each reward can be taken once.

export type ChallengeDef = { key: string; title: string; description: string; goal: number; points: number };

export const CHALLENGES: ChallengeDef[] = [
  { key: 'back_labs', title: 'Back five labs', description: 'Vote for five labs this week.', goal: 5, points: 20 },
  { key: 'learn_two', title: 'Two lessons', description: 'Finish two lessons in Learn.', goal: 2, points: 20 },
  { key: 'talk_three', title: 'Start conversations', description: 'Post or comment in Community three times.', goal: 3, points: 20 },
  { key: 'ship_updates', title: 'Show your progress', description: 'Post build-log updates or finish board tasks, twice.', goal: 2, points: 20 },
  { key: 'start_lab', title: 'Start something', description: 'Create a new lab.', goal: 1, points: 25 },
  { key: 'show_up', title: 'Show up', description: 'RSVP to an event.', goal: 1, points: 15 },
  { key: 'explore_labs', title: 'Find new favourites', description: 'Vote for three labs on three different days.', goal: 3, points: 20 },
  { key: 'cheer', title: 'Cheer people on', description: 'Comment on three posts.', goal: 3, points: 15 },
];

export const WEEKLY_BONUS = 25;
export const CHALLENGES_PER_WEEK = 3;

/** The Monday (YYYY-MM-DD) that starts the week containing `day`. */
export const mondayOf = (day: string): string => {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return shiftDay(day, -((dow + 6) % 7));
};

/** Same three challenges for everyone in the same week; they rotate so a pair rarely repeats. */
export const challengesForWeek = (monday: string): ChallengeDef[] => {
  const n = Math.floor(Date.parse(`${monday}T00:00:00Z`) / (7 * 86_400_000));
  const start = (((n * CHALLENGES_PER_WEEK) % CHALLENGES.length) + CHALLENGES.length) % CHALLENGES.length;
  return Array.from({ length: CHALLENGES_PER_WEEK }, (_, i) => CHALLENGES[(start + i) % CHALLENGES.length]!);
};

export type Window = { monday: Date; start: Date; end: Date };

export const progressFor = async (key: string, userId: string, w: Window): Promise<number> => {
  const between = { gte: w.start, lt: w.end };
  const inWeek = { gte: w.monday, lt: new Date(w.monday.getTime() + 7 * 86_400_000) }; // for @db.Date columns
  switch (key) {
    case 'back_labs':
      return prisma.vote.count({ where: { user_id: userId, vote_day: inWeek } });
    case 'explore_labs': {
      const days = await prisma.vote.findMany({ where: { user_id: userId, vote_day: inWeek }, select: { vote_day: true }, distinct: ['vote_day'] });
      return days.length;
    }
    case 'learn_two':
      return prisma.lessonProgress.count({ where: { user_id: userId, completed_at: between } });
    case 'talk_three':
      return (await prisma.post.count({ where: { author_id: userId, created_at: between } })) + (await prisma.comment.count({ where: { author_id: userId, created_at: between } }));
    case 'cheer':
      return prisma.comment.count({ where: { author_id: userId, created_at: between } });
    case 'ship_updates':
      return (await prisma.labUpdate.count({ where: { author_id: userId, created_at: between } })) +
        (await prisma.labTask.count({ where: { done_at: between, lab: { members: { some: { user_id: userId } } } } }));
    case 'start_lab':
      return prisma.project.count({ where: { user_id: userId, created_at: between } });
    case 'show_up':
      return prisma.eventRsvp.count({ where: { user_id: userId, created_at: between } });
    default:
      return 0;
  }
};

export async function thisWeek(userId: string, now: Date = new Date()) {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const tz = me?.timezone ?? null;
  const today = localDay(tz, now);
  const monday = mondayOf(today);
  const todayStart = new Date(nextLocalMidnight(tz, now).getTime() - 86_400_000);
  const daysIn = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${monday}T00:00:00Z`)) / 86_400_000);
  // Local midnights are 24h apart except across a clock change, when this can be an hour out.
  const start = new Date(todayStart.getTime() - daysIn * 86_400_000);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const w: Window = { monday: dayToDb(monday), start, end };

  const defs = challengesForWeek(monday);
  const [progress, claims] = await Promise.all([
    Promise.all(defs.map((d) => progressFor(d.key, userId, w))),
    prisma.weeklyClaim.findMany({ where: { user_id: userId, week: w.monday }, select: { key: true } }),
  ]);
  const claimed = new Set(claims.map((c) => c.key));
  const challenges = defs.map((d, i) => ({ ...d, progress: Math.min(progress[i]!, d.goal), complete: progress[i]! >= d.goal, claimed: claimed.has(d.key) }));
  return {
    week: w.monday,
    challenges,
    bonus: { points: WEEKLY_BONUS, available: challenges.every((c) => c.claimed), claimed: claimed.has('bonus') },
    resets_at: end,
  };
}
