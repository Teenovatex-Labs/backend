import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { awardPointsTx } from '../lib/points.js';

const LESSON_POINTS = 5;

export const listTracks = async (req: AuthRequest, res: Response): Promise<void> => {
  const tracks = await prisma.track.findMany({
    where: { published: true },
    orderBy: { position: 'asc' },
    include: { lessons: { select: { id: true, minutes: true } } },
  });

  const done = req.userId
    ? await prisma.lessonProgress.findMany({
        where: { user_id: req.userId, lesson_id: { in: tracks.flatMap((t) => t.lessons.map((l) => l.id)) } },
        select: { lesson_id: true },
      })
    : [];
  const doneIds = new Set(done.map((d) => d.lesson_id));

  res.json({
    tracks: tracks.map((t) => ({
      id: t.id,
      slug: t.slug,
      title: t.title,
      description: t.description,
      lesson_count: t.lessons.length,
      minutes: t.lessons.reduce((n, l) => n + l.minutes, 0),
      completed_count: t.lessons.filter((l) => doneIds.has(l.id)).length,
    })),
  });
};

export const getTrack = async (req: AuthRequest, res: Response): Promise<void> => {
  const { slug } = req.params as { slug: string };
  const track = await prisma.track.findFirst({
    where: { slug, published: true },
    include: { lessons: { orderBy: { position: 'asc' }, select: { id: true, slug: true, title: true, summary: true, minutes: true } } },
  });
  if (!track) { res.status(404).json({ error: 'Track not found', code: 'NOT_FOUND' }); return; }

  const done = req.userId
    ? await prisma.lessonProgress.findMany({
        where: { user_id: req.userId, lesson_id: { in: track.lessons.map((l) => l.id) } },
        select: { lesson_id: true },
      })
    : [];
  const doneIds = new Set(done.map((d) => d.lesson_id));

  res.json({
    id: track.id,
    slug: track.slug,
    title: track.title,
    description: track.description,
    lessons: track.lessons.map((l) => ({ ...l, completed: doneIds.has(l.id) })),
  });
};

export const getLesson = async (req: AuthRequest, res: Response): Promise<void> => {
  const { slug, lessonSlug } = req.params as { slug: string; lessonSlug: string };
  const track = await prisma.track.findFirst({
    where: { slug, published: true },
    include: { lessons: { orderBy: { position: 'asc' } } },
  });
  const index = track?.lessons.findIndex((l) => l.slug === lessonSlug) ?? -1;
  if (!track || index < 0) { res.status(404).json({ error: 'Lesson not found', code: 'NOT_FOUND' }); return; }

  const lesson = track.lessons[index]!;
  const completed = req.userId
    ? !!(await prisma.lessonProgress.findUnique({ where: { user_id_lesson_id: { user_id: req.userId, lesson_id: lesson.id } } }))
    : false;
  const link = (l?: { slug: string; title: string }) => (l ? { slug: l.slug, title: l.title } : null);

  res.json({
    id: lesson.id,
    slug: lesson.slug,
    title: lesson.title,
    summary: lesson.summary,
    body: lesson.body,
    minutes: lesson.minutes,
    completed,
    track: { slug: track.slug, title: track.title },
    prev: link(track.lessons[index - 1]),
    next: link(track.lessons[index + 1]),
  });
};

// Finishing a lesson pays once, ever. Doing it again is a harmless no-op.
export const completeLesson = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const userId = req.userId!;

  const lesson = await prisma.lesson.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!lesson) { res.status(404).json({ error: 'Lesson not found', code: 'NOT_FOUND' }); return; }

  const awarded = await prisma.$transaction(async (tx) => {
    const { count } = await tx.lessonProgress.createMany({ data: [{ user_id: userId, lesson_id: id }], skipDuplicates: true });
    if (count === 0) return 0;
    await awardPointsTx(tx, userId, 'lesson', LESSON_POINTS, `Finished lesson "${lesson.title}"`, id);
    return LESSON_POINTS;
  });

  res.json({ completed: true, points_awarded: awarded });
};

