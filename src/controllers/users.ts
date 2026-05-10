import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { uploadToCloudinary } from '../middleware/upload.js';

const publicSelect = {
  id: true,
  username: true,
  full_name: true,
  avatar_url: true,
  bio: true,
  social_links: true,
  points: true,
  streak: true,
  created_at: true,
} as const;

const getRank = async (points: number) =>
  (await prisma.user.count({ where: { points: { gt: points } } })) + 1;

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { ...publicSelect, email: true, last_login_at: true, updated_at: true, settings: true },
  });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }

  res.json({ ...user, rank: await getRank(user.points) });
};

export const updateMe = async (req: AuthRequest, res: Response): Promise<void> => {
  const body = req.body as {
    full_name?: string;
    bio?: string;
    social_links?: Record<string, string>;
  };

  const updated = await prisma.user.update({
    where: { id: req.userId },
    data: {
      ...(body.full_name !== undefined && { full_name: body.full_name }),
      ...(body.bio !== undefined && { bio: body.bio }),
      ...(body.social_links !== undefined && { social_links: body.social_links }),
    },
    select: publicSelect,
  });

  res.json(updated);
};

export const uploadAvatar = async (
  req: AuthRequest & { file?: Express.Multer.File },
  res: Response
): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded', code: 'NO_FILE' });
    return;
  }

  const avatar_url = await uploadToCloudinary(req.file.buffer, 'avatars');
  await prisma.user.update({ where: { id: req.userId }, data: { avatar_url } });

  res.json({ avatar_url });
};

export const getUserByUsername = async (req: Request, res: Response): Promise<void> => {
  const { username } = req.params as { username: string };

  const user = await prisma.user.findUnique({ where: { username }, select: publicSelect });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }

  res.json({ ...user, rank: await getRank(user.points) });
};

export const getUserProjects = async (req: Request, res: Response): Promise<void> => {
  const { username } = req.params as { username: string };

  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }

  const projects = await prisma.project.findMany({
    where: { user_id: user.id },
    orderBy: { created_at: 'desc' },
  });

  res.json(projects);
};

export const followUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const { username } = req.params as { username: string };
  const target = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!target) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }
  if (target.id === req.userId) {
    res.status(400).json({ error: 'Cannot follow yourself', code: 'INVALID' });
    return;
  }

  await prisma.follow.upsert({
    where: { follower_id_following_id: { follower_id: req.userId!, following_id: target.id } },
    create: { follower_id: req.userId!, following_id: target.id },
    update: {},
  });

  res.json({ message: `Following ${username}` });
};

export const unfollowUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const { username } = req.params as { username: string };
  const target = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!target) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }

  await prisma.follow.deleteMany({
    where: { follower_id: req.userId, following_id: target.id },
  });

  res.json({ message: `Unfollowed ${username}` });
};
