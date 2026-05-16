import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';

// Shared user select for list view 
const listSelect = {
  id:           true,
  username:     true,
  full_name:    true,
  email:        true,
  role:         true,
  banned:       true,
  points:       true,
  streak:       true,
  avatar_url:   true,
  created_at:   true,
  last_login_at: true,
  _count: { select: { projects: true, votes: true, sessions: true } },
} as const;

// GET /api/v1/admin/users 
export const listUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    page   = '1',
    limit  = '20',
    search = '',
    status = 'all',
    sort   = 'newest',
  } = req.query as Record<string, string>;

  const pageNum  = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip     = (pageNum - 1) * limitNum;

  // ── Filter ──────────────────────────────────────────────────────────────────
  const statusFilter =
    status === 'banned' ? { banned: true } :
    status === 'active' ? { banned: false } :
    {};

  const searchFilter = search.trim()
    ? {
        OR: [
          { username:  { contains: search, mode: 'insensitive' as const } },
          { email:     { contains: search, mode: 'insensitive' as const } },
          { full_name: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const where = { ...statusFilter, ...searchFilter };

  // ── Sort ────────────────────────────────────────────────────────────────────
  const orderBy =
    sort === 'points' ? { points:     'desc' as const } :
    sort === 'votes'  ? { votes:      { _count: 'desc' as const } } :
    /* newest */        { created_at: 'desc' as const };

  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy, skip, take: limitNum, select: listSelect }),
    prisma.user.count({ where }),
  ]);

  res.json({
    users,
    total,
    page:  pageNum,
    pages: Math.ceil(total / limitNum),
  });
};

// ─── GET /api/v1/admin/users/:id ─────────────────────────────────────────────
export const getUserById = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id:            true,
      username:      true,
      full_name:     true,
      email:         true,
      role:          true,
      banned:        true,
      avatar_url:    true,
      bio:           true,
      social_links:  true,
      points:        true,
      streak:        true,
      last_login_at: true,
      created_at:    true,
      updated_at:    true,
      settings:      true,
      _count: { select: { sessions: true, projects: true, votes: true } },
    },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    return;
  }

  res.json({ ...user, sessions_count: user._count.sessions });
};

// ─── PATCH /api/v1/admin/users/:id/ban ───────────────────────────────────────
export const banUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { reason } = req.body as { reason?: string };

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, banned: true } });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }
  if (user.banned) { res.status(409).json({ error: 'User is already banned', code: 'ALREADY_BANNED' }); return; }

  // Ban + wipe all sessions atomically
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { banned: true } }),
    prisma.session.deleteMany({ where: { user_id: id } }),
    ...(reason
      ? [prisma.notification.create({
          data: { user_id: id, type: 'ban', message: reason },
        })]
      : []),
  ]);

  res.json({ message: `User ${user.username} has been banned`, username: user.username });
};

// ─── PATCH /api/v1/admin/users/:id/unban ─────────────────────────────────────
export const unbanUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, banned: true } });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }
  if (!user.banned) { res.status(409).json({ error: 'User is not banned', code: 'NOT_BANNED' }); return; }

  await prisma.user.update({ where: { id }, data: { banned: false } });

  res.json({ message: `User ${user.username} has been unbanned`, username: user.username });
};

// ─── PATCH /api/v1/admin/users/:id/points ────────────────────────────────────
export const adjustPoints = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { amount, reason } = req.body as { amount: number; reason: string };

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, points: true } });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }

  const previous_points = user.points;
  const new_points      = Math.max(0, previous_points + amount); // floor at 0

  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { points: new_points } }),
    prisma.pointsLog.create({ data: { user_id: id, points: amount, reason, reference_id: 'admin_adjustment' } }),
  ]);

  res.json({
    message:         `Points adjusted for ${user.username}`,
    username:        user.username,
    previous_points,
    new_points,
    amount,
  });
};

// ─── DELETE /api/v1/admin/users/:id ──────────────────────────────────────────
export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  // confirm is validated by Zod
  const { confirm } = req.body as { confirm: boolean };

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }

  // Cascade is handled by onDelete: Cascade on all child relations in schema
  await prisma.user.delete({ where: { id } });

  res.json({ message: 'User and all associated data permanently deleted' });
};
