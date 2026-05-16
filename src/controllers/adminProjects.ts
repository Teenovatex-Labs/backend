
import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';

// ─── GET /api/v1/admin/projects ─────────────────────────────────────────────
export const listProjects = async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    page     = '1',
    limit    = '20',
    search   = '',
    status   = 'all',
    category = '',
    sort     = 'newest',
  } = req.query as Record<string, string>;

  const pageNum  = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip     = (pageNum - 1) * limitNum;

  // ── Filter ──────────────────────────────────────────────────────────────────
  const statusFilter =
    status === 'featured' ? { featured: true } :
    status === 'flagged'  ? { flagged: true } :
    {};

  const searchFilter = search.trim()
    ? {
        OR: [
          { name:              { contains: search, mode: 'insensitive' as const } },
          { short_description: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const categoryFilter = category.trim() ? { category } : {};

  const where = { ...statusFilter, ...searchFilter, ...categoryFilter };

  // ── Sort ────────────────────────────────────────────────────────────────────
  const orderBy =
    sort === 'votes'   ? { vote_count: 'desc' as const } :
    sort === 'flagged' ? { flag_count: 'desc' as const } :
    /* newest */         { created_at: 'desc' as const };

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy,
      skip,
      take: limitNum,
      select: {
        id:           true,
        name:         true,
        slug:         true,
        category:     true,
        vote_count:   true,
        featured:     true,
        flagged:      true,
        flag_count:   true,
        created_at:   true,
        user: { select: { id: true, username: true, email: true } },
      },
    }),
    prisma.project.count({ where }),
  ]);

  res.json({
    projects,
    total,
    page:  pageNum,
    pages: Math.ceil(total / limitNum),
  });
};

// ─── GET /api/v1/admin/projects/flagged ──────────────────────────────────────
export const listFlaggedProjects = async (req: AuthRequest, res: Response): Promise<void> => {
  const { page = '1', limit = '20' } = req.query as Record<string, string>;

  const pageNum  = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip     = (pageNum - 1) * limitNum;

  const where = { flagged: true };

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: { flag_count: 'desc' },
      skip,
      take: limitNum,
      select: {
        id:           true,
        name:         true,
        slug:         true,
        category:     true,
        vote_count:   true,
        featured:     true,
        flagged:      true,
        flag_count:   true,
        flag_reasons: true,
        created_at:   true,
        user: { select: { id: true, username: true, email: true } },
      },
    }),
    prisma.project.count({ where }),
  ]);

  res.json({
    projects,
    total,
    page:  pageNum,
    pages: Math.ceil(total / limitNum),
  });
};

// ─── PATCH /api/v1/admin/projects/:id/feature ────────────────────────────────
export const featureProject = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };

  const project = await prisma.project.findUnique({
    where: { id },
    include: { user: { select: { username: true } } },
  });

  if (!project) { res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' }); return; }
  if (project.featured) { res.status(409).json({ error: 'Project is already featured', code: 'ALREADY_FEATURED' }); return; }

  await prisma.$transaction([
    prisma.project.update({ where: { id }, data: { featured: true } }),
    prisma.notification.create({
      data: {
        user_id: project.user_id,
        type: 'feature',
        message: `Your project "${project.name}" has been featured! +50 points`,
      },
    }),
    prisma.user.update({
      where: { id: project.user_id },
      data: { points: { increment: 50 } },
    }),
    prisma.pointsLog.create({
      data: {
        user_id: project.user_id,
        points: 50,
        reason: 'Project featured by admin',
        reference_id: project.id,
      },
    }),
  ]);

  res.json({
    message: `Project ${project.name} featured`,
    points_awarded: 50,
    builder: project.user.username,
  });
};

// ─── PATCH /api/v1/admin/projects/:id/unfeature ──────────────────────────────
export const unfeatureProject = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };

  const project = await prisma.project.findUnique({ where: { id }, select: { id: true, name: true, featured: true } });
  if (!project) { res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' }); return; }
  if (!project.featured) { res.status(409).json({ error: 'Project is not featured', code: 'NOT_FEATURED' }); return; }

  await prisma.project.update({ where: { id }, data: { featured: false } });

  res.json({ message: `Project ${project.name} unfeatured` });
};

// ─── DELETE /api/v1/admin/projects/:id ───────────────────────────────────────
export const deleteProject = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { reason } = req.body as { reason: string };

  const project = await prisma.project.findUnique({ where: { id }, select: { id: true, name: true, user_id: true } });
  if (!project) { res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' }); return; }

  await prisma.$transaction([
    prisma.project.delete({ where: { id } }),
    prisma.notification.create({
      data: {
        user_id: project.user_id,
        type: 'project_deleted',
        message: `Your project "${project.name}" was deleted by an admin. Reason: ${reason}`,
      },
    }),
  ]);

  res.json({
    message: `Project ${project.name} deleted`,
    reason,
  });
};
