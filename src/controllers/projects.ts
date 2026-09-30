import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { slugify, uniqueSlug } from '../lib/slug.js';
import { awardPoints } from '../lib/points.js';
import { uploadToCloudinary } from '../middleware/upload.js';
import { createProjectSchema } from '../schemas/project.js';
import { dayToDb, localDay } from '../lib/day.js';
import { assertClean } from '../lib/guard.js';
import { checkBadgesQuietly } from '../lib/badges.js';

type MulterAuthRequest = AuthRequest & { file?: Express.Multer.File };

export const createProject = async (req: MulterAuthRequest, res: Response): Promise<void> => {
  // Normalize tags from multipart (may be string or array)
  const rawTags = req.body.tags as string | string[] | undefined;
  const tags = Array.isArray(rawTags) ? rawTags : rawTags ? [String(rawTags)] : [];
  req.body.tags = tags;

  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Validation failed', code: 'VALIDATION_ERROR' });
    return;
  }

  const { name, short_description, description, category, demo_url, github_url, tx_post_url } = parsed.data;
  await assertClean(req.userId!, [name, short_description, description, ...tags]);

  const base = slugify(name);
  const slug = await uniqueSlug(base, async (s) => !!(await prisma.project.findUnique({ where: { slug: s } })));

  let cover_url: string | undefined;
  if (req.file) cover_url = await uploadToCloudinary(req.file.buffer, 'projects');

  const project = await prisma.project.create({
    data: {
      members: { create: { user_id: req.userId!, role: 'owner' } },
      user_id: req.userId!,
      name,
      slug,
      short_description,
      description,
      category,
      cover_url: cover_url ?? null,
      demo_url: demo_url ?? null,
      github_url: github_url ?? null,
      tx_post_url: tx_post_url ?? null,
      tags,
    },
    include: { user: { select: { username: true, avatar_url: true } } },
  });

  if (tx_post_url) {
    await awardPoints(req.userId!, 'post_tagged', 5, 'Posted update and tagged TX', project.id);
  }

  checkBadgesQuietly(req.userId);
  res.status(201).json({
    id: project.id,
    name: project.name,
    slug: project.slug,
    builder: { username: project.user.username, avatar_url: project.user.avatar_url },
    vote_count: 0,
    created_at: project.created_at,
  });
};

const TRENDING_WINDOW_DAYS = 7;
const userInclude = { user: { select: { username: true, avatar_url: true } } } as const;

/** Which of these projects the signed-in member has already voted on today (their day). */
const votedTodayIds = async (userId: string | undefined, projectIds: string[]): Promise<Set<string>> => {
  if (!userId || projectIds.length === 0) return new Set();
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const votes = await prisma.vote.findMany({
    where: { user_id: userId, project_id: { in: projectIds }, vote_day: dayToDb(localDay(me?.timezone)) },
    select: { project_id: true },
  });
  return new Set(votes.map((v) => v.project_id));
};

export const listProjects = async (req: AuthRequest, res: Response): Promise<void> => {
  const { page = '1', limit = '12', sort = 'newest', category, search } = req.query as Record<string, string | undefined>;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 12));
  const skip = (pageNum - 1) * limitNum;

  const where = {
    ...(category ? { category } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { short_description: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  let projects;
  let total: number;

  if (sort === 'trending') {
    // Trending = votes received in the last week, ties broken by all-time votes then newest.
    const since = new Date(Date.now() - TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [all, recent] = await Promise.all([
      prisma.project.findMany({ where, select: { id: true, vote_count: true, created_at: true } }),
      prisma.vote.groupBy({ by: ['project_id'], where: { voted_at: { gte: since }, project: where }, _count: { _all: true } }),
    ]);
    const weekly = new Map(recent.map((r) => [r.project_id, r._count._all]));
    const ranked = all
      .sort(
        (x, y) =>
          (weekly.get(y.id) ?? 0) - (weekly.get(x.id) ?? 0) ||
          y.vote_count - x.vote_count ||
          y.created_at.getTime() - x.created_at.getTime()
      )
      .slice(skip, skip + limitNum);
    const found = await prisma.project.findMany({ where: { id: { in: ranked.map((r) => r.id) } }, include: userInclude });
    const byId = new Map(found.map((p) => [p.id, p]));
    projects = ranked.map((r) => byId.get(r.id)!).filter(Boolean);
    total = all.length;
  } else {
    const orderBy = sort === 'votes' ? { vote_count: 'desc' as const } : { created_at: 'desc' as const };
    [projects, total] = await prisma.$transaction([
      prisma.project.findMany({ where, orderBy, skip, take: limitNum, include: userInclude }),
      prisma.project.count({ where }),
    ]);
  }

  const voted = await votedTodayIds(req.userId, projects.map((p) => p.id));
  res.json({
    projects: projects.map((p) => ({ ...p, has_voted_today: voted.has(p.id) })),
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum),
  });
};

export const listMyProjects = async (req: AuthRequest, res: Response): Promise<void> => {
  const projects = await prisma.project.findMany({
    where: { user_id: req.userId },
    orderBy: { created_at: 'desc' },
    include: userInclude,
  });
  res.json({ projects, total: projects.length });
};

export const listCategories = async (_req: Request, res: Response): Promise<void> => {
  const groups = await prisma.project.groupBy({ by: ['category'], _count: { _all: true }, orderBy: { category: 'asc' } });
  res.json({ categories: groups.map((g) => ({ name: g.category, count: g._count._all })) });
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A lab can be opened by its id or by its readable slug (what the address bar shows).
export const getProject = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };

  const project = await prisma.project.findUnique({
    where: UUID.test(id) ? { id } : { slug: id },
    include: { user: { select: { username: true, full_name: true, avatar_url: true } } },
  });

  if (!project) { res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' }); return; }
  const voted = await votedTodayIds(req.userId, [project.id]);
  res.json({ ...project, has_voted_today: voted.has(project.id) });
};

export const updateProject = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const project = await prisma.project.findUnique({ where: { id } });

  if (!project) { res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' }); return; }
  if (project.user_id !== req.userId) { res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' }); return; }

  const body = req.body as {
    name?: string;
    short_description?: string;
    description?: string;
    category?: string;
    demo_url?: string;
    github_url?: string;
    tx_post_url?: string;
    tags?: string[];
  };

  await assertClean(req.userId!, [body.name, body.short_description, body.description, ...(body.tags ?? [])]);

  const updated = await prisma.project.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.short_description !== undefined && { short_description: body.short_description }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.demo_url !== undefined && { demo_url: body.demo_url }),
      ...(body.github_url !== undefined && { github_url: body.github_url }),
      ...(body.tx_post_url !== undefined && { tx_post_url: body.tx_post_url }),
      ...(body.tags !== undefined && { tags: body.tags }),
    },
  });

  res.json(updated);
};

export const deleteProject = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const project = await prisma.project.findUnique({ where: { id } });

  if (!project) { res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' }); return; }
  if (project.user_id !== req.userId) { res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' }); return; }

  await prisma.project.delete({ where: { id } });
  res.json({ message: 'Project deleted' });
};
