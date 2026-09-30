import type { Response } from 'express';
import type { Prisma, Role } from '@prisma/client';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { createNotification } from '../lib/notify.js';

const DAY = 24 * 60 * 60 * 1000;
const PAGE = 20;
const paging = (q: Record<string, unknown>) => {
  const page = Math.max(1, parseInt(String(q.page ?? '1')) || 1);
  return { page, skip: (page - 1) * PAGE, take: PAGE };
};

const actor = async (req: AuthRequest) => {
  const me = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, role: true } });
  if (!me) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');
  return me;
};

/** Moderators act on members; only admins may act on other staff. */
const assertCanActOn = async (me: { id: string; role: Role }, targetId: string) => {
  if (me.id === targetId) throw new HttpError(400, 'INVALID', "You can't do that to yourself");
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { role: true } });
  if (!target) throw new HttpError(404, 'NOT_FOUND', 'Member not found');
  if (target.role !== 'member' && target.role !== 'mentor' && me.role !== 'admin') {
    throw new HttpError(403, 'FORBIDDEN', 'Only an admin can act on staff accounts');
  }
};

export const stats = async (_req: AuthRequest, res: Response): Promise<void> => {
  const since = new Date(Date.now() - 7 * DAY);
  const [users, newUsers, labs, posts, openReports, suspended] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { created_at: { gte: since } } }),
    prisma.project.count(),
    prisma.post.count({ where: { hidden: false } }),
    prisma.report.count({ where: { status: 'open' } }),
    prisma.user.count({ where: { suspended_until: { gt: new Date() } } }),
  ]);
  res.json({ users, new_users_7d: newUsers, labs, posts, open_reports: openReports, suspended });
};

// --- reports -------------------------------------------------------------------------------

/** What the moderator needs to see to decide, without leaving the queue. */
const describeTarget = async (type: string, id: string) => {
  switch (type) {
    case 'post': {
      const p = await prisma.post.findUnique({ where: { id }, include: { author: { select: { username: true } } } });
      return p ? { exists: true, title: p.title, excerpt: p.body.slice(0, 400), author: p.author.username, hidden: p.hidden } : { exists: false };
    }
    case 'comment': {
      const c = await prisma.comment.findUnique({ where: { id }, include: { author: { select: { username: true } } } });
      return c ? { exists: true, excerpt: c.body.slice(0, 400), author: c.author.username, hidden: c.hidden } : { exists: false };
    }
    case 'lab': {
      const l = await prisma.project.findUnique({ where: { id }, include: { user: { select: { username: true } } } });
      return l ? { exists: true, title: l.name, excerpt: l.short_description, author: l.user.username, slug: l.slug } : { exists: false };
    }
    case 'user': {
      const u = await prisma.user.findUnique({ where: { id }, select: { username: true, bio: true } });
      return u ? { exists: true, title: `@${u.username}`, excerpt: u.bio ?? '', author: u.username } : { exists: false };
    }
    case 'message': {
      // Moderators only ever see a private conversation because somebody in it reported it, and
      // only the few messages around the reported one.
      const m = await prisma.message.findUnique({ where: { id }, include: { sender: { select: { username: true } } } });
      if (!m) return { exists: false };
      const around = await prisma.message.findMany({
        where: { conversation_id: m.conversation_id, hidden: false, created_at: { gte: new Date(m.created_at.getTime() - 60 * 60_000), lte: new Date(m.created_at.getTime() + 60 * 60_000) } },
        orderBy: { created_at: 'asc' },
        take: 12,
        include: { sender: { select: { username: true } } },
      });
      return {
        exists: true,
        title: 'Private message',
        excerpt: m.body.slice(0, 400),
        author: m.sender.username,
        hidden: m.hidden,
        context: around.map((x) => ({ id: x.id, from: x.sender.username, body: x.body.slice(0, 300), reported: x.id === id })),
      };
    }
    default:
      return { exists: false };
  }
};

export const listReports = async (req: AuthRequest, res: Response): Promise<void> => {
  const status = ['open', 'actioned', 'dismissed'].includes(String(req.query.status)) ? (req.query.status as 'open' | 'actioned' | 'dismissed') : 'open';
  const { page, skip, take } = paging(req.query);
  const where: Prisma.ReportWhereInput = { status };

  // The queue is small, so sort it in memory: self-harm reports always come first, then oldest first.
  const all = await prisma.report.findMany({
    where,
    orderBy: { created_at: 'asc' },
    take: 1000,
    include: { reporter: { select: { username: true } } },
  });
  all.sort((a, b) => Number(b.reason === 'self_harm') - Number(a.reason === 'self_harm'));
  const total = all.length;
  const rows = all.slice(skip, skip + take);

  const items = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      target_type: r.target_type,
      target_id: r.target_id,
      reason: r.reason,
      details: r.details,
      status: r.status,
      created_at: r.created_at,
      handled_at: r.handled_at,
      note: r.note,
      reporter: r.reporter.username,
      target: await describeTarget(r.target_type, r.target_id),
      // Context that shows a pattern: other reports on this exact thing, and against this member overall.
      reports_on_target: await prisma.report.count({ where: { target_type: r.target_type, target_id: r.target_id } }),
      reports_on_member: r.target_user_id ? await prisma.report.count({ where: { target_user_id: r.target_user_id } }) : 0,
      target_user_id: r.target_user_id,
    }))
  );
  res.json({ items, total, page, pages: Math.ceil(total / PAGE) });
};

export const resolveReport = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { action, note, days } = req.body as { action: 'dismiss' | 'warn' | 'remove' | 'suspend'; note?: string; days?: number };
  const me = await actor(req);

  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) throw new HttpError(404, 'NOT_FOUND', 'Report not found');
  if (report.status !== 'open') throw new HttpError(409, 'ALREADY_HANDLED', 'Someone already handled this report');
  if (action === 'suspend' && !days) throw new HttpError(400, 'VALIDATION_ERROR', 'Say how many days to suspend for');
  if (action !== 'dismiss' && report.target_user_id) await assertCanActOn(me, report.target_user_id);

  await prisma.$transaction(async (tx) => {
    if (action === 'remove') {
      if (report.target_type === 'post') await tx.post.updateMany({ where: { id: report.target_id }, data: { hidden: true } });
      else if (report.target_type === 'comment') {
        const c = await tx.comment.findUnique({ where: { id: report.target_id }, select: { post_id: true, hidden: true } });
        if (c && !c.hidden) {
          await tx.comment.update({ where: { id: report.target_id }, data: { hidden: true } });
          await tx.post.update({ where: { id: c.post_id }, data: { comment_count: { decrement: 1 } } });
        }
      } else if (report.target_type === 'message') await tx.message.updateMany({ where: { id: report.target_id }, data: { hidden: true } });
      else if (report.target_type === 'lab') await tx.project.deleteMany({ where: { id: report.target_id } });
      else throw new HttpError(400, 'UNSUPPORTED_ACTION', 'Content of that type can only be warned or suspended');
    }
    if (action === 'suspend' && report.target_user_id) {
      await tx.user.update({
        where: { id: report.target_user_id },
        data: { suspended_until: new Date(Date.now() + days! * DAY), suspended_reason: note ?? report.reason },
      });
    }
    await tx.report.updateMany({
      where: action === 'dismiss' ? { id } : { target_type: report.target_type, target_id: report.target_id, status: 'open' },
      data: { status: action === 'dismiss' ? 'dismissed' : 'actioned', handled_by: me.id, handled_at: new Date(), note: note ?? null },
    });
    await audit(me.id, `report.${action}`, { type: report.target_type, id: report.target_id }, { report_id: id, reason: report.reason, note: note ?? null, days: days ?? null }, tx);
  });

  // Tell the member what happened, kindly and plainly.
  if (report.target_user_id && action !== 'dismiss') {
    const messages = {
      warn: `A moderator reviewed something you shared and is asking you to follow the community guidelines. ${note ?? ''}`.trim(),
      remove: `A moderator removed something you shared because it broke the community guidelines. ${note ?? ''}`.trim(),
      suspend: `Your account is paused for ${days} day${days === 1 ? '' : 's'}. You can still read, but you can't post or vote until it ends. ${note ?? ''}`.trim(),
    } as const;
    await createNotification(report.target_user_id, 'moderation', messages[action]);
  }

  res.json({ message: 'Done', action });
};

// --- members -------------------------------------------------------------------------------

export const listUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  const { page, skip, take } = paging(req.query);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const where: Prisma.UserWhereInput = search
    ? { OR: [{ username: { contains: search, mode: 'insensitive' } }, { full_name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] }
    : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take,
      select: { id: true, username: true, full_name: true, email: true, role: true, points: true, created_at: true, suspended_until: true, suspended_reason: true },
    }),
    prisma.user.count({ where }),
  ]);
  const counts = await prisma.report.groupBy({ by: ['target_user_id'], where: { target_user_id: { in: users.map((u) => u.id) } }, _count: { _all: true } });
  const byUser = new Map(counts.map((c) => [c.target_user_id, c._count._all]));
  res.json({ items: users.map((u) => ({ ...u, reports_against: byUser.get(u.id) ?? 0 })), total, page, pages: Math.ceil(total / PAGE) });
};

export const suspendUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { days, reason } = req.body as { days: number; reason: string };
  const me = await actor(req);
  await assertCanActOn(me, id);
  const until = new Date(Date.now() + days * DAY);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { suspended_until: until, suspended_reason: reason } });
    await audit(me.id, 'user.suspend', { type: 'user', id }, { days, reason }, tx);
  });
  await createNotification(id, 'moderation', `Your account is paused for ${days} day${days === 1 ? '' : 's'}. ${reason}`);
  res.json({ message: 'Suspended', suspended_until: until.toISOString() });
};

export const unsuspendUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const me = await actor(req);
  await assertCanActOn(me, id);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { suspended_until: null, suspended_reason: null } });
    await audit(me.id, 'user.unsuspend', { type: 'user', id }, undefined, tx);
  });
  res.json({ message: 'Unsuspended' });
};

// Admins only (enforced in the router).
export const setRole = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { role } = req.body as { role: Role };
  const me = await actor(req);
  if (me.id === id) throw new HttpError(400, 'INVALID', "You can't change your own role");
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) throw new HttpError(404, 'NOT_FOUND', 'Member not found');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { role } });
    await audit(me.id, 'user.role', { type: 'user', id }, { from: target.role, to: role }, tx);
  });
  res.json({ message: 'Role updated', role });
};

export const listAudit = async (req: AuthRequest, res: Response): Promise<void> => {
  const { page, skip, take } = paging(req.query);
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { created_at: 'desc' }, skip, take }),
    prisma.auditLog.count(),
  ]);
  const actors = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.actor_id).filter((x): x is string => !!x) } }, select: { id: true, username: true } });
  const names = new Map(actors.map((a) => [a.id, a.username]));
  res.json({ items: rows.map((r) => ({ ...r, actor: r.actor_id ? names.get(r.actor_id) ?? null : null })), total, page, pages: Math.ceil(total / PAGE) });
};
