import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { windowState } from '../lib/admissions.js';
import type { AuthRequest } from '../middleware/auth.js';

type Dates = { opens_at: Date; closes_at: Date; decisions_publish_at: Date };

const checkDates = async (d: Dates, ignoreId?: string) => {
  if (!(d.opens_at < d.closes_at)) throw new HttpError(400, 'VALIDATION_ERROR', 'The window must close after it opens');
  if (!(d.closes_at <= d.decisions_publish_at)) throw new HttpError(400, 'VALIDATION_ERROR', 'Decisions cannot be released before the window closes');
  const clash = await prisma.applicationWindow.findFirst({
    where: { id: { not: ignoreId }, opens_at: { lt: d.closes_at }, closes_at: { gt: d.opens_at } },
  });
  if (clash) throw new HttpError(409, 'WINDOW_OVERLAP', 'Another window already covers part of these dates');
};

const shape = (w: { id: string; opens_at: Date; closes_at: Date; decisions_publish_at: Date; target_size: number | null; status: string; note: string | null }, counts?: Record<string, number>) => ({
  id: w.id,
  opens_at: w.opens_at.toISOString(),
  closes_at: w.closes_at.toISOString(),
  decisions_publish_at: w.decisions_publish_at.toISOString(),
  target_size: w.target_size,
  note: w.note,
  state: windowState(w),
  released: w.status === 'published',
  ...(counts && { applications: counts }),
});

export const listCohorts = async (_req: Request, res: Response): Promise<void> => {
  const windows = await prisma.applicationWindow.findMany({ orderBy: { opens_at: 'desc' } });
  const grouped = await prisma.application.groupBy({ by: ['window_id', 'status'], _count: { _all: true } });
  const items = windows.map((w) => {
    const counts: Record<string, number> = {};
    for (const g of grouped) if (g.window_id === w.id) counts[g.status] = g._count._all;
    return shape(w, counts);
  });
  res.json({ items });
};

export const createCohort = async (req: AuthRequest, res: Response): Promise<void> => {
  const b = req.body as Dates & { target_size?: number | null; note?: string | null };
  await checkDates(b);
  const w = await prisma.applicationWindow.create({
    data: { opens_at: b.opens_at, closes_at: b.closes_at, decisions_publish_at: b.decisions_publish_at, target_size: b.target_size ?? null, note: b.note ?? null, form_version: 'v1', created_by: req.userId },
  });
  await audit(req.userId!, 'cohort.create', { type: 'application_window', id: w.id });
  res.status(201).json(shape(w));
};

export const updateCohort = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const current = await prisma.applicationWindow.findUnique({ where: { id } });
  if (!current) throw new HttpError(404, 'NOT_FOUND', 'Window not found');
  if (current.status === 'published') throw new HttpError(409, 'WINDOW_RELEASED', 'Decisions were already released for this window');
  const b = req.body as Partial<Dates> & { target_size?: number | null; note?: string | null };
  // Once applicants can see a window, its opening time is fixed.
  if (b.opens_at && windowState(current) !== 'upcoming' && b.opens_at.getTime() !== current.opens_at.getTime()) {
    throw new HttpError(409, 'WINDOW_STARTED', 'This window has already opened, so its opening time cannot change');
  }
  const next = { opens_at: b.opens_at ?? current.opens_at, closes_at: b.closes_at ?? current.closes_at, decisions_publish_at: b.decisions_publish_at ?? current.decisions_publish_at };
  await checkDates(next, id);
  const w = await prisma.applicationWindow.update({
    where: { id },
    data: { ...next, ...(b.target_size !== undefined && { target_size: b.target_size }), ...(b.note !== undefined && { note: b.note }) },
  });
  await audit(req.userId!, 'cohort.update', { type: 'application_window', id });
  res.json(shape(w));
};
