import { prisma } from '../db.js';
import { createNotification } from './notify.js';

// Badges are earned automatically. Each one has a rule that counts real activity, so they can't be
// claimed by clicking. `checkBadges` is safe to call as often as you like: it only ever adds.

export type BadgeDef = { key: string; title: string; description: string; symbol: string };

export const BADGES: BadgeDef[] = [
  { key: 'first_lab', title: 'Lab Starter', description: 'Started your first lab', symbol: '◆' },
  { key: 'first_vote', title: 'Supporter', description: 'Voted for a lab', symbol: '♥' },
  { key: 'first_comment', title: 'Conversation Starter', description: 'Posted or commented in Community', symbol: '✎' },
  { key: 'first_lesson', title: 'Student', description: 'Finished a lesson', symbol: '✓' },
  { key: 'track_done', title: 'Graduate', description: 'Finished a whole Learn track', symbol: '★' },
  { key: 'streak_3', title: 'On a Roll', description: 'A 3-day streak', symbol: '3' },
  { key: 'streak_7', title: 'Week Warrior', description: 'A 7-day streak', symbol: '7' },
  { key: 'streak_30', title: 'Unstoppable', description: 'A 30-day streak', symbol: '30' },
  { key: 'loved_10', title: 'Crowd Favourite', description: 'Your labs have 10 votes between them', symbol: '10' },
  { key: 'team_player', title: 'Team Player', description: 'Joined someone else’s lab team', symbol: '+' },
  { key: 'milestone', title: 'Finisher', description: 'Reached a milestone', symbol: '⚑' },
  { key: 'friend', title: 'Connected', description: 'Made a mutual follow', symbol: '∞' },
];

/** Which badge keys this member currently qualifies for, from real data. */
async function qualifying(userId: string): Promise<Set<string>> {
  const [user, labs, votes, posts, comments, updates, lessons, tracks, teamJoins, milestones, following, followers, voteSum] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { streak: true } }),
    prisma.project.count({ where: { user_id: userId } }),
    prisma.vote.count({ where: { user_id: userId } }),
    prisma.post.count({ where: { author_id: userId } }),
    prisma.comment.count({ where: { author_id: userId } }),
    prisma.labUpdate.count({ where: { author_id: userId } }),
    prisma.lessonProgress.count({ where: { user_id: userId } }),
    prisma.track.findMany({ where: { published: true }, select: { id: true, lessons: { select: { id: true } } } }),
    prisma.labMember.count({ where: { user_id: userId, role: 'member' } }),
    prisma.labMilestone.count({ where: { done_at: { not: null }, lab: { members: { some: { user_id: userId } } } } }),
    prisma.follow.findMany({ where: { follower_id: userId }, select: { following_id: true } }),
    prisma.follow.findMany({ where: { following_id: userId }, select: { follower_id: true } }),
    prisma.project.aggregate({ where: { user_id: userId }, _sum: { vote_count: true } }),
  ]);

  const done = new Set((await prisma.lessonProgress.findMany({ where: { user_id: userId }, select: { lesson_id: true } })).map((l) => l.lesson_id));
  const finishedTrack = tracks.some((t) => t.lessons.length > 0 && t.lessons.every((l) => done.has(l.id)));
  const followed = new Set(following.map((f) => f.following_id));
  const mutual = followers.some((f) => followed.has(f.follower_id));
  const streak = user?.streak ?? 0;

  const earned = new Set<string>();
  if (labs > 0) earned.add('first_lab');
  if (votes > 0) earned.add('first_vote');
  if (posts + comments + updates > 0) earned.add('first_comment');
  if (lessons > 0) earned.add('first_lesson');
  if (finishedTrack) earned.add('track_done');
  if (streak >= 3) earned.add('streak_3');
  if (streak >= 7) earned.add('streak_7');
  if (streak >= 30) earned.add('streak_30');
  if ((voteSum._sum.vote_count ?? 0) >= 10) earned.add('loved_10');
  if (teamJoins > 0) earned.add('team_player');
  if (milestones > 0) earned.add('milestone');
  if (mutual) earned.add('friend');
  return earned;
}

/** Awards anything newly earned, tells the member, and returns the new badges. */
export async function checkBadges(userId: string): Promise<BadgeDef[]> {
  const [have, now] = await Promise.all([
    prisma.userBadge.findMany({ where: { user_id: userId }, select: { key: true } }),
    qualifying(userId),
  ]);
  const owned = new Set(have.map((b) => b.key));
  const fresh = BADGES.filter((b) => now.has(b.key) && !owned.has(b.key));
  if (fresh.length === 0) return [];

  // createMany + skipDuplicates makes a race harmless: only the request that really inserted tells the member.
  const { count } = await prisma.userBadge.createMany({ data: fresh.map((b) => ({ user_id: userId, key: b.key })), skipDuplicates: true });
  if (count === 0) return [];
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  for (const b of fresh) {
    await createNotification(userId, 'badge', `New badge: ${b.title}. ${b.description}.`, { link: `/u/${me?.username}`, payload: { badge: b.key } });
  }
  return fresh;
}

/** Fire-and-forget for call sites that must never fail because of a badge. */
export const checkBadgesQuietly = (userId: string | undefined | null) => {
  if (!userId) return;
  void checkBadges(userId).catch((err) => console.error('Badge check failed:', err));
};
