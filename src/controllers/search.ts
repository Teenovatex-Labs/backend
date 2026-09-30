import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { blockedEitherWay } from './safety.js';

const PER_TYPE = 5;

// One search box for everything a member can see. It never returns anything they couldn't open
// directly: private profiles, hidden posts and blocked members' content are left out.
export const search = async (req: AuthRequest, res: Response): Promise<void> => {
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  if (q.length < 2) { res.json({ q, labs: [], people: [], posts: [], lessons: [], events: [] }); return; }
  // LIKE treats % and _ as wildcards, so a member's own % or _ must be escaped to mean themselves.
  const literal = q.replace(/[\\%_]/g, '\\$&');
  const contains = { contains: literal, mode: 'insensitive' as const };
  const hidden = await blockedEitherWay(req.userId);
  const notHidden = hidden.length ? { notIn: hidden } : undefined;

  const [labs, people, posts, lessons, events] = await Promise.all([
    prisma.project.findMany({
      where: { OR: [{ name: contains }, { short_description: contains }, { tags: { has: q.toLowerCase() } }], ...(notHidden ? { user_id: notHidden } : {}) },
      orderBy: { vote_count: 'desc' },
      take: PER_TYPE,
      select: { id: true, name: true, slug: true, short_description: true, category: true, vote_count: true, user: { select: { username: true } } },
    }),
    prisma.user.findMany({
      where: {
        OR: [{ username: contains }, { full_name: contains }],
        // A member who turned off "public profile" can't be found by search.
        NOT: { settings: { public_profile: false } },
        ...(notHidden ? { id: notHidden } : {}),
        username_set: true,
      },
      orderBy: { points: 'desc' },
      take: PER_TYPE,
      select: { username: true, full_name: true, avatar_url: true, points: true },
    }),
    prisma.post.findMany({
      where: { hidden: false, OR: [{ title: contains }, { body: contains }], ...(notHidden ? { author_id: notHidden } : {}) },
      orderBy: { created_at: 'desc' },
      take: PER_TYPE,
      select: { id: true, title: true, body: true, created_at: true, space: { select: { name: true, slug: true } }, author: { select: { username: true } } },
    }),
    prisma.lesson.findMany({
      where: { track: { published: true }, OR: [{ title: contains }, { summary: contains }] },
      take: PER_TYPE,
      select: { slug: true, title: true, summary: true, track: { select: { slug: true, title: true } } },
    }),
    prisma.event.findMany({
      where: { OR: [{ title: contains }, { description: contains }] },
      orderBy: { starts_at: 'desc' },
      take: PER_TYPE,
      select: { id: true, title: true, starts_at: true, location: true },
    }),
  ]);

  res.json({
    q,
    labs,
    people: people.map((p) => ({ username: p.username, full_name: p.full_name, avatar_url: p.avatar_url, points: p.points })),
    posts: posts.map((p) => ({ id: p.id, title: p.title, excerpt: p.body.slice(0, 140), created_at: p.created_at, space: p.space, author: p.author.username })),
    lessons,
    events,
  });
};
