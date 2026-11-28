import type { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import type { AuthRequest } from '../middleware/auth.js';
import { moderationQuerySchema, moderationTargetIdSchema, moderationTargetTypeSchema } from '../schemas/moderation.js';

type ContentType = 'post' | 'comment' | 'lab';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const parseQuery = (req: AuthRequest) => {
  const parsed = moderationQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid query');
  }
  return parsed.data;
};

const dateFilter = (from?: string, to?: string): Prisma.DateTimeFilter | undefined =>
  from || to
    ? {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(to) }),
      }
    : undefined;

const reportedIdFilter = async (type: ContentType, reported?: boolean) => {
  if (reported === undefined) return undefined;
  const rows = await prisma.report.findMany({
    where: { target_type: type, status: 'open' },
    select: { target_id: true },
  });
  const ids = rows.map((row) => row.target_id);
  if (reported) return { in: ids };
  return ids.length ? { notIn: ids } : undefined;
};

const openReportCounts = async (type: ContentType, ids: string[]) => {
  if (!ids.length) return new Map<string, number>();
  const counts = await prisma.report.groupBy({
    by: ['target_id'],
    where: { target_type: type, status: 'open', target_id: { in: ids } },
    _count: { _all: true },
  });
  return new Map(counts.map((row) => [row.target_id, row._count._all]));
};

const pageOptions = (query: ReturnType<typeof parseQuery>) => ({
  orderBy: [{ created_at: 'desc' as const }, { id: 'desc' as const }],
  take: (query.limit ?? 20) + 1,
  ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
});

const pageResponse = <T extends { id: string }>(rows: T[], limit: number | undefined) => {
  const pageSize = limit ?? 20;
  const hasMore = rows.length > pageSize;
  const items = rows.slice(0, pageSize);
  return {
    items,
    next_cursor: hasMore ? items[items.length - 1]!.id : null,
  };
};

const ensureCursorExists = async (type: ContentType, cursor?: string): Promise<void> => {
  if (!cursor) return;
  const exists =
    type === 'post'
      ? await prisma.post.findUnique({ where: { id: cursor }, select: { id: true } })
      : type === 'comment'
        ? await prisma.comment.findUnique({ where: { id: cursor }, select: { id: true } })
        : await prisma.project.findUnique({ where: { id: cursor }, select: { id: true } });
  if (!exists) throw new HttpError(400, 'INVALID_CURSOR', 'The cursor does not identify existing content');
};

export const listPosts = async (req: AuthRequest, res: Response): Promise<void> => {
  const query = parseQuery(req);
  await ensureCursorExists('post', query.cursor);
  const id = await reportedIdFilter('post', query.reported === undefined ? undefined : query.reported === 'true');
  const created_at = dateFilter(query.from, query.to);
  const where: Prisma.PostWhereInput = {
    ...(query.hidden !== undefined && { hidden: query.hidden === 'true' }),
    ...(created_at && { created_at }),
    ...(id && { id }),
    ...(query.q && {
      OR: [
        { title: { contains: query.q, mode: 'insensitive' } },
        { body: { contains: query.q, mode: 'insensitive' } },
        { author: { is: { username: { contains: query.q, mode: 'insensitive' } } } },
      ],
    }),
  };
  const rows = await prisma.post.findMany({
    where,
    ...pageOptions(query),
    select: { id: true, title: true, body: true, hidden: true, created_at: true, author: { select: { username: true } } },
  });
  const page = pageResponse(rows, query.limit);
  const counts = await openReportCounts('post', page.items.map((row) => row.id));
  res.json({
    items: page.items.map((row) => ({
      id: row.id,
      title: row.title,
      excerpt: row.body.slice(0, 400),
      author: row.author.username,
      hidden: row.hidden,
      created_at: row.created_at,
      open_report_count: counts.get(row.id) ?? 0,
    })),
    next_cursor: page.next_cursor,
  });
};

export const listComments = async (req: AuthRequest, res: Response): Promise<void> => {
  const query = parseQuery(req);
  await ensureCursorExists('comment', query.cursor);
  const id = await reportedIdFilter('comment', query.reported === undefined ? undefined : query.reported === 'true');
  const created_at = dateFilter(query.from, query.to);
  const where: Prisma.CommentWhereInput = {
    ...(query.hidden !== undefined && { hidden: query.hidden === 'true' }),
    ...(created_at && { created_at }),
    ...(id && { id }),
    ...(query.q && {
      OR: [
        { body: { contains: query.q, mode: 'insensitive' } },
        { author: { is: { username: { contains: query.q, mode: 'insensitive' } } } },
      ],
    }),
  };
  const rows = await prisma.comment.findMany({
    where,
    ...pageOptions(query),
    select: { id: true, body: true, hidden: true, created_at: true, author: { select: { username: true } } },
  });
  const page = pageResponse(rows, query.limit);
  const counts = await openReportCounts('comment', page.items.map((row) => row.id));
  res.json({
    items: page.items.map((row) => ({
      id: row.id,
      excerpt: row.body.slice(0, 400),
      author: row.author.username,
      hidden: row.hidden,
      created_at: row.created_at,
      open_report_count: counts.get(row.id) ?? 0,
    })),
    next_cursor: page.next_cursor,
  });
};

export const listLabs = async (req: AuthRequest, res: Response): Promise<void> => {
  const query = parseQuery(req);
  await ensureCursorExists('lab', query.cursor);
  const id = await reportedIdFilter('lab', query.reported === undefined ? undefined : query.reported === 'true');
  const created_at = dateFilter(query.from, query.to);
  const where: Prisma.ProjectWhereInput = {
    ...(query.hidden !== undefined && { hidden: query.hidden === 'true' }),
    ...(created_at && { created_at }),
    ...(id && { id }),
    ...(query.q && {
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { short_description: { contains: query.q, mode: 'insensitive' } },
        { category: { contains: query.q, mode: 'insensitive' } },
        { user: { is: { username: { contains: query.q, mode: 'insensitive' } } } },
      ],
    }),
  };
  const rows = await prisma.project.findMany({
    where,
    ...pageOptions(query),
    select: { id: true, name: true, short_description: true, hidden: true, created_at: true, user: { select: { username: true } } },
  });
  const page = pageResponse(rows, query.limit);
  const counts = await openReportCounts('lab', page.items.map((row) => row.id));
  res.json({
    items: page.items.map((row) => ({
      id: row.id,
      title: row.name,
      excerpt: row.short_description.slice(0, 400),
      author: row.user.username,
      hidden: row.hidden,
      created_at: row.created_at,
      open_report_count: counts.get(row.id) ?? 0,
    })),
    next_cursor: page.next_cursor,
  });
};

export const moderationStats = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');

  const now = new Date();
  const since = new Date(now.getTime() - SEVEN_DAYS_MS);
  const [caller, openReports, oldestOpenReport, openImageReviews, suspendedUsers, callerActions] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } }),
    prisma.report.count({ where: { status: 'open' } }),
    prisma.report.findFirst({ where: { status: 'open' }, orderBy: { created_at: 'asc' }, select: { created_at: true } }),
    prisma.messageAttachment.count({ where: { status: 'pending' } }),
    prisma.user.count({ where: { suspended_until: { gt: now } } }),
    prisma.auditLog.count({ where: { actor_id: req.userId, created_at: { gte: since } } }),
  ]);
  if (!caller) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');

  const result = {
    open_reports: openReports,
    oldest_open_report_age_seconds: oldestOpenReport
      ? Math.floor(Math.max(0, now.getTime() - oldestOpenReport.created_at.getTime()) / 1000)
      : null,
    open_image_reviews: openImageReviews,
    suspended_users: suspendedUsers,
    my_actions_7d: callerActions,
  };

  if (caller.role === 'admin') {
    const moderators = await prisma.user.findMany({
      where: { role: 'moderator' },
      select: { id: true, username: true },
      orderBy: { username: 'asc' },
    });
    const actions = moderators.length
      ? await prisma.auditLog.groupBy({
          by: ['actor_id'],
          where: { actor_id: { in: moderators.map((moderator) => moderator.id) }, created_at: { gte: since } },
          _count: { _all: true },
        })
      : [];
    const actionCounts = new Map(actions.map((entry) => [entry.actor_id, entry._count._all]));

    res.json({
      ...result,
      moderator_actions_7d: moderators.map((moderator) => ({
        username: moderator.username,
        actions: actionCounts.get(moderator.id) ?? 0,
      })),
    });
    return;
  }

  res.json(result);
};

const changeVisibility =
  (hidden: boolean) =>
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsedType = moderationTargetTypeSchema.safeParse(req.params.type);
    if (!parsedType.success) throw new HttpError(400, 'VALIDATION_ERROR', 'type must be post, comment or lab');
    const parsedId = moderationTargetIdSchema.safeParse(req.params.id);
    if (!parsedId.success) throw new HttpError(400, 'VALIDATION_ERROR', 'id must be a UUID');
    const type = parsedType.data;
    const id = parsedId.data;
    const action = hidden ? 'hide' : 'restore';

    await prisma.$transaction(async (tx) => {
      if (type === 'post') {
        const row = await tx.post.findUnique({ where: { id }, select: { hidden: true } });
        if (!row) throw new HttpError(404, 'NOT_FOUND', 'Post not found');
        if (row.hidden === hidden) throw new HttpError(409, hidden ? 'ALREADY_HIDDEN' : 'NOT_HIDDEN', 'Post is already in that visibility state');
        const changed = await tx.post.updateMany({ where: { id, hidden: row.hidden }, data: { hidden } });
        if (changed.count !== 1) throw new HttpError(409, 'CONTENT_CHANGED', 'Post visibility changed; retry the request');
      } else if (type === 'comment') {
        const row = await tx.comment.findUnique({ where: { id }, select: { post_id: true, hidden: true } });
        if (!row) throw new HttpError(404, 'NOT_FOUND', 'Comment not found');
        if (row.hidden === hidden) throw new HttpError(409, hidden ? 'ALREADY_HIDDEN' : 'NOT_HIDDEN', 'Comment is already in that visibility state');
        const changed = await tx.comment.updateMany({ where: { id, hidden: row.hidden }, data: { hidden } });
        if (changed.count !== 1) throw new HttpError(409, 'CONTENT_CHANGED', 'Comment visibility changed; retry the request');
        await tx.post.update({
          where: { id: row.post_id },
          data: { comment_count: hidden ? { decrement: 1 } : { increment: 1 } },
        });
      } else {
        const row = await tx.project.findUnique({ where: { id }, select: { hidden: true } });
        if (!row) throw new HttpError(404, 'NOT_FOUND', 'Lab not found');
        if (row.hidden === hidden) throw new HttpError(409, hidden ? 'ALREADY_HIDDEN' : 'NOT_HIDDEN', 'Lab is already in that visibility state');
        const changed = await tx.project.updateMany({ where: { id, hidden: row.hidden }, data: { hidden } });
        if (changed.count !== 1) throw new HttpError(409, 'CONTENT_CHANGED', 'Lab visibility changed; retry the request');
      }

      await audit(req.userId!, `moderation.${action}`, { type, id }, undefined, tx);
    });

    res.json({ message: hidden ? 'Content hidden' : 'Content restored' });
  };

export const hideContent = changeVisibility(true);
export const restoreContent = changeVisibility(false);
