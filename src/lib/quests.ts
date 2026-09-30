import { prisma } from '../db.js';
import { dayToDb, localDay, nextLocalMidnight } from './day.js';

// One small goal per day, the same for everyone, picked by the calendar. Progress is counted from
// real activity that happened on the member's own day, so it can't be faked.

export type QuestDef = { key: string; title: string; description: string; goal: number; points: number };

export const QUESTS: QuestDef[] = [
  { key: 'vote', title: 'Back a lab', description: 'Vote for a lab you like today.', goal: 1, points: 5 },
  { key: 'lesson', title: 'Learn something', description: 'Finish a lesson in Learn.', goal: 1, points: 5 },
  { key: 'talk', title: 'Join the conversation', description: 'Post or comment in Community.', goal: 1, points: 5 },
  { key: 'build', title: 'Move a lab forward', description: 'Post a build-log update, or finish a task on your board.', goal: 1, points: 5 },
  { key: 'explore', title: 'Go exploring', description: 'Vote on two different labs today.', goal: 2, points: 5 },
];

/** Same quest for everyone on the same calendar day. */
export const questForDay = (day: string): QuestDef => {
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  return QUESTS[((n % QUESTS.length) + QUESTS.length) % QUESTS.length]!;
};

const progressFor = async (key: string, userId: string, day: Date, dayStart: Date, dayEnd: Date): Promise<number> => {
  const between = { gte: dayStart, lt: dayEnd };
  switch (key) {
    case 'vote':
    case 'explore':
      return prisma.vote.count({ where: { user_id: userId, vote_day: day } });
    case 'lesson':
      return prisma.lessonProgress.count({ where: { user_id: userId, completed_at: between } });
    case 'talk':
      return (await prisma.post.count({ where: { author_id: userId, created_at: between } })) + (await prisma.comment.count({ where: { author_id: userId, created_at: between } }));
    case 'build':
      return (await prisma.labUpdate.count({ where: { author_id: userId, created_at: between } })) +
        (await prisma.labTask.count({ where: { done_at: between, lab: { members: { some: { user_id: userId } } } } }));
    default:
      return 0;
  }
};

export async function todaysQuest(userId: string, now: Date = new Date()) {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const tz = me?.timezone ?? null;
  const today = localDay(tz, now);
  const quest = questForDay(today);
  const end = nextLocalMidnight(tz, now);
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const day = dayToDb(today);

  const [progress, claim] = await Promise.all([
    progressFor(quest.key, userId, day, start, end),
    prisma.questClaim.findUnique({ where: { user_id_day: { user_id: userId, day } } }),
  ]);
  return { quest, day, today, progress: Math.min(progress, quest.goal), complete: progress >= quest.goal, claimed: !!claim, resets_at: end };
}
