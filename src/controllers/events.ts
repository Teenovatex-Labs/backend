import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { createNotification } from '../lib/notify.js';

const shape = (
  e: { id: string; title: string; description: string; starts_at: Date; ends_at: Date | null; location: string | null; cover_url: string | null; capacity: number | null; _count: { rsvps: number }; rsvps?: { user_id: string }[] }
) => {
  const { _count, rsvps, ...rest } = e;
  return { ...rest, rsvp_count: _count.rsvps, has_rsvped: (rsvps?.length ?? 0) > 0, is_full: e.capacity !== null && _count.rsvps >= e.capacity };
};

// Counts everyone's RSVPs and, separately, whether this visitor has one (nobody, if signed out).
const withMine = (userId: string | undefined) => ({
  _count: { select: { rsvps: true } },
  rsvps: { where: { user_id: userId ?? '' }, select: { user_id: true } },
});

/** `when=upcoming` (default): not over yet, soonest first. `when=past`: over, most recent first. */
export const listEvents = async (req: AuthRequest, res: Response): Promise<void> => {
  const when = req.query.when === 'past' ? 'past' : 'upcoming';
  const now = new Date();
  // An event with no end time counts as over 3 hours after it starts.
  const graceStart = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const upcoming = { OR: [{ ends_at: { gte: now } }, { ends_at: null, starts_at: { gte: graceStart } }] };
  // Written out rather than NOT(upcoming): SQL's NOT of a NULL comparison would drop events with no end time.
  const past = { OR: [{ ends_at: { lt: now } }, { ends_at: null, starts_at: { lt: graceStart } }] };

  const events = await prisma.event.findMany({
    where: when === 'upcoming' ? upcoming : past,
    orderBy: { starts_at: when === 'upcoming' ? 'asc' : 'desc' },
    take: 50,
    include: withMine(req.userId),
  });
  res.json({ events: events.map(shape) });
};

export const getEvent = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const event = await prisma.event.findUnique({
    where: { id },
    include: withMine(req.userId),
  });
  if (!event) { res.status(404).json({ error: 'Event not found', code: 'NOT_FOUND' }); return; }
  res.json(shape(event));
};

export const rsvp = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const userId = req.userId!;

  const result = await prisma.$transaction(async (tx) => {
    // One event at a time so the capacity check and the insert can't be split by a rival request.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const event = await tx.event.findUnique({ where: { id }, include: { _count: { select: { rsvps: true } } } });
    if (!event) return 'missing' as const;
    if (event.starts_at.getTime() < Date.now() - 3 * 60 * 60 * 1000) return 'over' as const;
    const already = await tx.eventRsvp.findUnique({ where: { event_id_user_id: { event_id: id, user_id: userId } } });
    if (already) return { event, created: false };
    if (event.capacity !== null && event._count.rsvps >= event.capacity) return 'full' as const;
    await tx.eventRsvp.create({ data: { event_id: id, user_id: userId } });
    return { event, created: true };
  });

  if (result === 'missing') { res.status(404).json({ error: 'Event not found', code: 'NOT_FOUND' }); return; }
  if (result === 'over') { res.status(400).json({ error: 'This event has already happened', code: 'EVENT_OVER' }); return; }
  if (result === 'full') { res.status(409).json({ error: 'This event is full', code: 'EVENT_FULL' }); return; }

  if (result.created) {
    await createNotification(userId, 'event', `You're in for "${result.event.title}"`, {
      link: `/events/${id}`,
      payload: { event_id: id, starts_at: result.event.starts_at.toISOString() },
    });
  }
  res.json({ message: "You're on the list", rsvp_count: await prisma.eventRsvp.count({ where: { event_id: id } }) });
};

export const cancelRsvp = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  await prisma.eventRsvp.deleteMany({ where: { event_id: id, user_id: req.userId } });
  res.json({ message: 'RSVP cancelled', rsvp_count: await prisma.eventRsvp.count({ where: { event_id: id } }) });
};

// Staff only (moderator / admin), enforced in the router.
export const createEvent = async (req: AuthRequest, res: Response): Promise<void> => {
  const b = req.body as { title: string; description: string; starts_at: string; ends_at?: string; location?: string; cover_url?: string; capacity?: number };
  const event = await prisma.event.create({
    data: {
      title: b.title,
      description: b.description,
      starts_at: new Date(b.starts_at),
      ends_at: b.ends_at ? new Date(b.ends_at) : null,
      location: b.location ?? null,
      cover_url: b.cover_url ?? null,
      capacity: b.capacity ?? null,
      created_by: req.userId,
    },
  });
  res.status(201).json(event);
};

export const updateEvent = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const b = req.body as Partial<{ title: string; description: string; starts_at: string; ends_at: string; location: string; cover_url: string; capacity: number }>;
  const exists = await prisma.event.findUnique({ where: { id }, select: { id: true } });
  if (!exists) { res.status(404).json({ error: 'Event not found', code: 'NOT_FOUND' }); return; }
  const event = await prisma.event.update({
    where: { id },
    data: {
      ...(b.title !== undefined && { title: b.title }),
      ...(b.description !== undefined && { description: b.description }),
      ...(b.starts_at !== undefined && { starts_at: new Date(b.starts_at) }),
      ...(b.ends_at !== undefined && { ends_at: new Date(b.ends_at) }),
      ...(b.location !== undefined && { location: b.location }),
      ...(b.cover_url !== undefined && { cover_url: b.cover_url }),
      ...(b.capacity !== undefined && { capacity: b.capacity }),
    },
  });
  res.json(event);
};

export const deleteEvent = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { count } = await prisma.event.deleteMany({ where: { id } });
  if (count === 0) { res.status(404).json({ error: 'Event not found', code: 'NOT_FOUND' }); return; }
  res.json({ message: 'Event deleted' });
};
