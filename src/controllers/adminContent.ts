import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

// --- analytics -----------------------------------------------------------------------------

type Point = { day: string; count: number };

/** One count per calendar day (UTC) for the last `days` days, with zeros filled in so charts have no gaps. */
const daily = async (rows: { day: Date; count: bigint }[], days: number): Promise<Point[]> => {
  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count)]));
  const out: Point[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day: d, count: byDay.get(d) ?? 0 });
  }
  return out;
};

export const analytics = async (req: AuthRequest, res: Response): Promise<void> => {
  const days = Math.min(90, Math.max(7, parseInt(String(req.query.days ?? '30')) || 30));
  const since = new Date(Date.now() - days * 86_400_000);

  const series = (table: Prisma.Sql, column: Prisma.Sql) =>
    prisma.$queryRaw<{ day: Date; count: bigint }[]>`SELECT date_trunc('day', ${column})::date AS day, COUNT(*)::bigint AS count FROM ${table} WHERE ${column} >= ${since} GROUP BY 1 ORDER BY 1`;

  const [signups, labs, posts, messages, votes, active, totals] = await Promise.all([
    series(Prisma.raw('"users"'), Prisma.raw('"created_at"')),
    series(Prisma.raw('"projects"'), Prisma.raw('"created_at"')),
    series(Prisma.raw('"posts"'), Prisma.raw('"created_at"')),
    series(Prisma.raw('"messages"'), Prisma.raw('"created_at"')),
    series(Prisma.raw('"votes"'), Prisma.raw('"voted_at"')),
    // Members active that day: anyone whose session was used.
    prisma.$queryRaw<{ day: Date; count: bigint }[]>`SELECT date_trunc('day', last_active)::date AS day, COUNT(DISTINCT user_id)::bigint AS count FROM sessions WHERE last_active >= ${since} GROUP BY 1 ORDER BY 1`,
    Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { projects: { some: {} } } }),
      prisma.user.count({ where: { votes: { some: {} } } }),
      prisma.user.count({ where: { lessons_done: { some: {} } } }),
      prisma.user.count({ where: { OR: [{ posts: { some: {} } }, { comments: { some: {} } }] } }),
    ]),
  ]);
  const [users, startedLab, voted, learned, talked] = totals;
  const pct = (n: number) => (users === 0 ? 0 : Math.round((n / users) * 100));

  res.json({
    days,
    signups: await daily(signups, days),
    active_members: await daily(active, days),
    labs_started: await daily(labs, days),
    posts: await daily(posts, days),
    messages: await daily(messages, days),
    votes: await daily(votes, days),
    // How many members have done each thing at least once: a quick read on what the community actually uses.
    adoption: { users, started_a_lab_pct: pct(startedLab), voted_pct: pct(voted), finished_a_lesson_pct: pct(learned), posted_or_commented_pct: pct(talked) },
  });
};

// --- Learn content -------------------------------------------------------------------------

const lessonFields = { slug: true, title: true, summary: true, minutes: true, position: true, id: true } as const;

export const listTracks = async (_req: AuthRequest, res: Response): Promise<void> => {
  const tracks = await prisma.track.findMany({ orderBy: { position: 'asc' }, include: { lessons: { orderBy: { position: 'asc' }, select: lessonFields } } });
  res.json({ tracks });
};

export const getLessonAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  const lesson = await prisma.lesson.findUnique({ where: { id: (req.params as { id: string }).id } });
  if (!lesson) throw new HttpError(404, 'NOT_FOUND', 'Lesson not found');
  res.json(lesson);
};

const uniqueGuard = (err: unknown, what: string): never => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new HttpError(409, 'SLUG_TAKEN', `That ${what} address is already used`);
  throw err;
};

export const createTrack = async (req: AuthRequest, res: Response): Promise<void> => {
  const b = req.body as { slug: string; title: string; description: string; published?: boolean };
  const last = await prisma.track.aggregate({ _max: { position: true } });
  try {
    const t = await prisma.track.create({ data: { ...b, position: (last._max.position ?? -1) + 1 } });
    await audit(req.userId!, 'learn.track.create', { type: 'track', id: t.id }, { title: t.title });
    res.status(201).json(t);
  } catch (e) { uniqueGuard(e, 'track'); }
};

export const updateTrack = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  try {
    const t = await prisma.track.update({ where: { id }, data: req.body });
    await audit(req.userId!, 'learn.track.update', { type: 'track', id }, { fields: Object.keys(req.body as object) });
    res.json(t);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new HttpError(404, 'NOT_FOUND', 'Track not found');
    uniqueGuard(e, 'track');
  }
};

export const deleteTrack = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { count } = await prisma.track.deleteMany({ where: { id } });
  if (count === 0) throw new HttpError(404, 'NOT_FOUND', 'Track not found');
  await audit(req.userId!, 'learn.track.delete', { type: 'track', id });
  res.json({ message: 'Track deleted' });
};

export const createLesson = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const track = await prisma.track.findUnique({ where: { id }, select: { id: true } });
  if (!track) throw new HttpError(404, 'NOT_FOUND', 'Track not found');
  const last = await prisma.lesson.aggregate({ where: { track_id: id }, _max: { position: true } });
  try {
    const l = await prisma.lesson.create({ data: { ...(req.body as object), track_id: id, position: (last._max.position ?? -1) + 1 } as Prisma.LessonUncheckedCreateInput });
    await audit(req.userId!, 'learn.lesson.create', { type: 'lesson', id: l.id }, { title: l.title });
    res.status(201).json(l);
  } catch (e) { uniqueGuard(e, 'lesson'); }
};

export const updateLesson = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  try {
    const l = await prisma.lesson.update({ where: { id }, data: req.body });
    await audit(req.userId!, 'learn.lesson.update', { type: 'lesson', id }, { fields: Object.keys(req.body as object) });
    res.json(l);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new HttpError(404, 'NOT_FOUND', 'Lesson not found');
    uniqueGuard(e, 'lesson');
  }
};

export const deleteLesson = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { count } = await prisma.lesson.deleteMany({ where: { id } });
  if (count === 0) throw new HttpError(404, 'NOT_FOUND', 'Lesson not found');
  await audit(req.userId!, 'learn.lesson.delete', { type: 'lesson', id });
  res.json({ message: 'Lesson deleted' });
};
