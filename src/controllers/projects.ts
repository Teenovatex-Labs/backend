import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { slugify, uniqueSlug } from '../lib/slug.js';
import { awardPoints } from '../lib/points.js';
import { uploadToCloudinary } from '../middleware/upload.js';
import { createProjectSchema } from '../schemas/project.js';

type MulterAuthRequest = AuthRequest & { file?: Express.Multer.File };

export const createProject = async (req: MulterAuthRequest, res: Response): Promise<void> => {
  
  const rawTags = req.body.tags as string | string[] | undefined;
  const tags = Array.isArray(rawTags) ? rawTags : rawTags ? [String(rawTags)] : [];
  req.body.tags = tags;

  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Validation failed', code: 'VALIDATION_ERROR' });
    return;
  }

  const { name, short_description, description, category, demo_url, github_url, tx_post_url } = parsed.data;

  const base = slugify(name);
  const slug = await uniqueSlug(base, async (s) => !!(await prisma.project.findUnique({ where: { slug: s } })));

  let cover_url: string | undefined;
  if (req.file) cover_url = await uploadToCloudinary(req.file.buffer, 'projects');

  const project = await prisma.project.create({
    data: {
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
    await awardPoints(req.userId!, 5, 'Posted update and tagged TX', project.id);
  }

  res.status(201).json({
    id: project.id,
    name: project.name,
    slug: project.slug,
    builder: { username: project.user.username, avatar_url: project.user.avatar_url },
    vote_count: 0,
    created_at: project.created_at,
  });
};

export const listProjects = async (req: Request, res: Response): Promise<void> => {
  const { page = '1', limit = '12', sort = 'newest', category, search } = req.query as Record<string, string | undefined>;

  const pageNum = Math.max(1, parseInt(page ?? '1'));
  const limitNum = Math.min(50, parseInt(limit ?? '12'));
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

  const orderBy =
    sort === 'votes' || sort === 'trending'
      ? { vote_count: 'desc' as const }
      : { created_at: 'desc' as const };

  const [projects, total] = await prisma.$transaction([
    prisma.project.findMany({
      where,
      orderBy,
      skip,
      take: limitNum,
      include: { user: { select: { username: true, avatar_url: true } } },
    }),
    prisma.project.count({ where }),
  ]);

  res.json({ projects, total, page: pageNum, pages: Math.ceil(total / limitNum) });
};

export const getProject = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };

  const project = await prisma.project.findUnique({
    where: { id },
    include: { user: { select: { username: true, full_name: true, avatar_url: true } } },
  });

  if (!project) { res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' }); return; }
  res.json(project);
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
