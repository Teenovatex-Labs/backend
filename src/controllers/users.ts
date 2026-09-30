import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { uploadToCloudinary } from '../middleware/upload.js';
import { MIN_AGE, ageOn, toDbDate } from '../lib/age.js';
import { createNotification } from '../lib/notify.js';
import { assertClean } from '../lib/guard.js';
import { levelFor } from '../lib/levels.js';
import { BADGES, checkBadgesQuietly } from '../lib/badges.js';

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
    select: {
      ...publicSelect,
      email: true,
      last_login_at: true,
      updated_at: true,
      settings: true,
      password_hash: true,
      google_id: true,
      birth_date: true,
      username_set: true,
      streak_freezes: true,
      suspended_until: true,
      suspended_reason: true,
      timezone: true,
      role: true,
    },
  });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }

  // Never send the hash itself — just whether one exists, so the frontend
  // can prompt a Google-only account to add a password without another
  // round trip.
  const { password_hash, google_id, birth_date, ...rest } = user;
  res.json({
    ...rest,
    // Members see their own birth date; it is never part of any public profile.
    birth_date: birth_date ? birth_date.toISOString().slice(0, 10) : null,
    age_confirmed: birth_date !== null,
    has_password: !!password_hash,
    has_google: !!google_id,
    level: levelFor(user.points),
    rank: await getRank(user.points),
  });
};

export const updateMe = async (req: AuthRequest, res: Response): Promise<void> => {
  const body = req.body as {
    full_name?: string;
    bio?: string;
    social_links?: Record<string, string>;
    timezone?: string;
  };

  // A bio is public, so it gets the same check as a post. Social links are separate fields on purpose.
  await assertClean(req.userId!, [body.full_name, body.bio], { allowLinks: true });

  const updated = await prisma.user.update({
    where: { id: req.userId },
    data: {
      ...(body.full_name !== undefined && { full_name: body.full_name }),
      ...(body.bio !== undefined && { bio: body.bio }),
      ...(body.social_links !== undefined && { social_links: body.social_links }),
      ...(body.timezone !== undefined && { timezone: body.timezone }),
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

// A member who turned off "public profile" is visible only to themselves.
const canSeeProfile = (viewerId: string | undefined, owner: { id: string; settings: { public_profile: boolean } | null }) =>
  viewerId === owner.id || owner.settings?.public_profile !== false;

export const getUserByUsername = async (req: AuthRequest, res: Response): Promise<void> => {
  const { username } = req.params as { username: string };

  const user = await prisma.user.findUnique({
    where: { username },
    select: { ...publicSelect, settings: { select: { public_profile: true } }, _count: { select: { projects: true } } },
  });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }

  if (!canSeeProfile(req.userId, user)) {
    // Enough to show a "private" card, nothing more.
    res.json({ username: user.username, avatar_url: user.avatar_url, private: true });
    return;
  }

  const { settings: _settings, _count, ...rest } = user;
  res.json({
    ...rest,
    private: false,
    level: levelFor(user.points),
    badges: (await prisma.userBadge.findMany({ where: { user_id: user.id }, orderBy: { awarded_at: 'asc' } })).flatMap((b) => {
      const def = BADGES.find((d) => d.key === b.key);
      return def ? [{ key: def.key, title: def.title, description: def.description, symbol: def.symbol, awarded_at: b.awarded_at }] : [];
    }),
    rank: await getRank(user.points),
    lab_count: _count.projects,
  });
};

export const getUserProjects = async (req: AuthRequest, res: Response): Promise<void> => {
  const { username } = req.params as { username: string };

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, settings: { select: { public_profile: true } } },
  });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }
  if (!canSeeProfile(req.userId, user)) { res.json({ projects: [] }); return; }

  const projects = await prisma.project.findMany({
    where: { user_id: user.id },
    orderBy: { created_at: 'desc' },
    include: { user: { select: { username: true, avatar_url: true } } },
  });

  res.json({ projects });
};

// For accounts created before the age gate (and Google sign-ups): set once, never edited
// by the member afterwards. Under-13 accounts are removed entirely.
export const setBirthDate = async (req: AuthRequest, res: Response): Promise<void> => {
  const { birth_date } = req.body as { birth_date: string };
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { birth_date: true } });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }
  if (user.birth_date) {
    res.status(409).json({ error: 'Your date of birth is already set. Contact us if it needs correcting.', code: 'ALREADY_SET' });
    return;
  }

  if (ageOn(birth_date) < MIN_AGE) {
    await prisma.user.delete({ where: { id: req.userId } });
    res.status(403).json({
      error: `TeenovateX is for ages ${MIN_AGE} and up, so we've removed this account. Come back when you're ${MIN_AGE}!`,
      code: 'AGE_TOO_YOUNG',
      account_removed: true,
    });
    return;
  }

  await prisma.user.update({ where: { id: req.userId }, data: { birth_date: toDbDate(birth_date) } });
  res.json({ message: 'Thanks, all set', age_confirmed: true });
};

// Google sign-ups arrive with a placeholder handle. They choose their own once; after
// that it is fixed, like the birth date.
export const setUsername = async (req: AuthRequest, res: Response): Promise<void> => {
  const { username } = req.body as { username: string };
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { username_set: true } });
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }
  if (user.username_set) {
    res.status(409).json({ error: 'Your username is already set.', code: 'ALREADY_SET' });
    return;
  }
  const taken = await prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: { id: true },
  });
  if (taken) {
    res.status(409).json({ error: 'That username is taken. Try another.', code: 'USERNAME_TAKEN' });
    return;
  }
  try {
    await prisma.user.update({ where: { id: req.userId }, data: { username, username_set: true } });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: 'That username is taken. Try another.', code: 'USERNAME_TAKEN' });
      return;
    }
    throw err;
  }
  res.json({ username });
};
