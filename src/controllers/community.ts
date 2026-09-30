import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { assertClean } from '../lib/guard.js';
import { createNotification } from '../lib/notify.js';
import { blockedEitherWay } from './safety.js';
import { checkBadgesQuietly } from '../lib/badges.js';

const PAGE = 15;
const author = { select: { username: true, avatar_url: true } } as const;

const shapePost = (
  p: { id: string; title: string; body: string; created_at: Date; comment_count: number; reaction_count: number; author: { username: string; avatar_url: string | null }; space?: { slug: string; name: string }; reactions?: { user_id: string }[] },
  full: boolean
) => ({
  id: p.id,
  title: p.title,
  body: full ? p.body : p.body.length > 240 ? `${p.body.slice(0, 240)}…` : p.body,
  created_at: p.created_at,
  comment_count: p.comment_count,
  reaction_count: p.reaction_count,
  author: p.author,
  space: p.space,
  has_reacted: (p.reactions?.length ?? 0) > 0,
});

const mine = (userId: string | undefined) => ({ where: { user_id: userId ?? '' }, select: { user_id: true } });

export const listSpaces = async (_req: AuthRequest, res: Response): Promise<void> => {
  const spaces = await prisma.space.findMany({
    orderBy: { position: 'asc' },
    include: { _count: { select: { posts: { where: { hidden: false } } } } },
  });
  res.json({ spaces: spaces.map((s) => ({ id: s.id, slug: s.slug, name: s.name, description: s.description, post_count: s._count.posts })) });
};

export const listPosts = async (req: AuthRequest, res: Response): Promise<void> => {
  const { slug } = req.params as { slug: string };
  const page = Math.max(1, parseInt(String(req.query.page ?? '1')) || 1);
  const space = await prisma.space.findUnique({ where: { slug } });
  if (!space) throw new HttpError(404, 'NOT_FOUND', 'Space not found');

  const hiddenAuthors = await blockedEitherWay(req.userId);
  const where: Prisma.PostWhereInput = { space_id: space.id, hidden: false, ...(hiddenAuthors.length ? { author_id: { notIn: hiddenAuthors } } : {}) };
  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { author, reactions: mine(req.userId) },
    }),
    prisma.post.count({ where }),
  ]);
  res.json({
    space: { slug: space.slug, name: space.name, description: space.description },
    posts: posts.map((p) => shapePost(p, false)),
    total,
    page,
    pages: Math.ceil(total / PAGE),
  });
};

export const getPost = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const hiddenAuthors = await blockedEitherWay(req.userId);
  const post = await prisma.post.findFirst({
    where: { id, hidden: false, ...(hiddenAuthors.length ? { author_id: { notIn: hiddenAuthors } } : {}) },
    include: { author, space: { select: { slug: true, name: true } }, reactions: mine(req.userId) },
  });
  if (!post) throw new HttpError(404, 'NOT_FOUND', 'That post is gone or you can no longer see it');

  const comments = await prisma.comment.findMany({
    where: { post_id: id, hidden: false, ...(hiddenAuthors.length ? { author_id: { notIn: hiddenAuthors } } : {}) },
    orderBy: { created_at: 'asc' },
    take: 200,
    include: { author },
  });
  res.json({
    ...shapePost(post, true),
    comments: comments.map((c) => ({ id: c.id, body: c.body, created_at: c.created_at, author: c.author })),
  });
};

export const createPost = async (req: AuthRequest, res: Response): Promise<void> => {
  const { slug } = req.params as { slug: string };
  const { title, body } = req.body as { title: string; body: string };
  const space = await prisma.space.findUnique({ where: { slug } });
  if (!space) throw new HttpError(404, 'NOT_FOUND', 'Space not found');

  await assertClean(req.userId!, [title, body]);

  // A soft daily ceiling on top of the rate limiter, so nobody floods a space.
  const today = await prisma.post.count({ where: { author_id: req.userId, created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
  if (today >= 10) throw new HttpError(429, 'POST_LIMIT', "That's plenty for today. Come back tomorrow with more.");

  const post = await prisma.post.create({ data: { space_id: space.id, author_id: req.userId!, title, body }, include: { author } });
  checkBadgesQuietly(req.userId);
  res.status(201).json(shapePost({ ...post, space: { slug: space.slug, name: space.name } }, true));
};

export const deletePost = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { count } = await prisma.post.deleteMany({ where: { id, author_id: req.userId } });
  if (count === 0) throw new HttpError(404, 'NOT_FOUND', 'Post not found');
  res.json({ message: 'Post deleted' });
};

export const createComment = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { body } = req.body as { body: string };

  const hiddenAuthors = await blockedEitherWay(req.userId);
  const post = await prisma.post.findFirst({ where: { id, hidden: false, ...(hiddenAuthors.length ? { author_id: { notIn: hiddenAuthors } } : {}) } });
  if (!post) throw new HttpError(404, 'NOT_FOUND', 'That post is gone or you can no longer see it');

  await assertClean(req.userId!, [body]);

  const [comment] = await prisma.$transaction([
    prisma.comment.create({ data: { post_id: id, author_id: req.userId!, body }, include: { author } }),
    prisma.post.update({ where: { id }, data: { comment_count: { increment: 1 } } }),
  ]);

  if (post.author_id !== req.userId) {
    await createNotification(post.author_id, 'comment', `${comment.author.username} commented on "${post.title}"`, { link: `/community/posts/${id}` });
  }
  checkBadgesQuietly(req.userId);
  res.status(201).json({ id: comment.id, body: comment.body, created_at: comment.created_at, author: comment.author });
};

export const deleteComment = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const comment = await prisma.comment.findFirst({ where: { id, author_id: req.userId } });
  if (!comment) throw new HttpError(404, 'NOT_FOUND', 'Comment not found');
  await prisma.$transaction([
    prisma.comment.delete({ where: { id } }),
    // Only count it down if it was still counted (a moderator-hidden comment already was).
    ...(comment.hidden ? [] : [prisma.post.update({ where: { id: comment.post_id }, data: { comment_count: { decrement: 1 } } })]),
  ]);
  res.json({ message: 'Comment deleted' });
};

export const react = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const on = req.method === 'POST';
  const post = await prisma.post.findFirst({ where: { id, hidden: false } });
  if (!post) throw new HttpError(404, 'NOT_FOUND', 'Post not found');

  const changed = await prisma.$transaction(async (tx) => {
    if (on) {
      const { count } = await tx.reaction.createMany({ data: [{ user_id: req.userId!, post_id: id }], skipDuplicates: true });
      if (count) await tx.post.update({ where: { id }, data: { reaction_count: { increment: 1 } } });
      return count;
    }
    const { count } = await tx.reaction.deleteMany({ where: { user_id: req.userId, post_id: id } });
    if (count) await tx.post.update({ where: { id }, data: { reaction_count: { decrement: 1 } } });
    return count;
  });

  const fresh = await prisma.post.findUnique({ where: { id }, select: { reaction_count: true } });
  res.json({ reaction_count: fresh?.reaction_count ?? 0, has_reacted: on, changed: changed > 0 });
};
