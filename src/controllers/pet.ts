import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { dayToDb, localDay } from '../lib/day.js';
import { AllProvidersFailed, hasProviders } from '../lib/pet/providers.js';
import { NAPPING, think, type Turn } from '../lib/pet/brain.js';
import { screenText, accountAgeDays } from '../lib/contentFilter.js';
import { removeVoteFor } from './votes.js';
import { z } from 'zod';

const MAX_TEXT = 500;
const MAX_MEMORIES = 10;

const today = async (userId: string) => {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  return dayToDb(localDay(me?.timezone));
};

export const status = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const [settings, used] = await Promise.all([
    prisma.userSettings.findUnique({ where: { user_id: userId } }),
    prisma.petUsage.findUnique({ where: { user_id_day: { user_id: userId, day: await today(userId) } } }),
  ]);
  res.json({
    available: config.pet.enabled && hasProviders(),
    enabled_by_member: settings?.ai_chat ?? false,
    remaining_today: Math.max(0, config.pet.dailyLimit - (used?.count ?? 0)),
    daily_limit: config.pet.dailyLimit,
    tour_done: !!settings?.alfred_tour_done_at,
  });
};

/** The member finished or skipped the welcome tour. It never shows again, on any device. */
export const tourDone = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  await prisma.userSettings.upsert({ where: { user_id: userId }, create: { user_id: userId, alfred_tour_done_at: new Date() }, update: { alfred_tour_done_at: new Date() } });
  res.json({ tour_done: true });
};

export const brain = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const { text, page, history } = req.body as { text: string; page?: string; history?: Turn[] };

  if (!config.pet.enabled || !hasProviders()) throw new HttpError(503, 'PET_NAPPING', NAPPING);

  // The member has to have switched this on themselves, after being told what it sends and where.
  const settings = await prisma.userSettings.findUnique({ where: { user_id: userId } });
  if (!settings?.ai_chat) throw new HttpError(403, 'AI_NOT_ENABLED', 'Alfred needs your OK before he uses AI. You can turn it on in Settings.');

  // Count the use first (atomically), so hitting the limit can't be dodged by racing requests.
  const day = await today(userId);
  const usage = await prisma.petUsage.upsert({
    where: { user_id_day: { user_id: userId, day } },
    create: { user_id: userId, day, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (usage.count > config.pet.dailyLimit) {
    await prisma.petUsage.update({ where: { user_id_day: { user_id: userId, day } }, data: { count: { decrement: 1 } } });
    throw new HttpError(429, 'PET_LIMIT', "I've done a lot of thinking for you today and need to rest my brain. Try again tomorrow, or use my quick commands.");
  }

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  try {
    // Only the words they typed, their username and the page they are on are sent. Never other
    // members' content, never email, never anything private.
    const [context, memories] = await Promise.all([buildContext(userId), prisma.petMemory.findMany({ where: { user_id: userId }, orderBy: { created_at: 'asc' }, take: MAX_MEMORIES })]);
    const result = await think({ text, username: me!.username, page, context, memories: memories.map((m) => m.text), history });
    res.json({ reply: result.reply, intent: result.intent, remaining_today: Math.max(0, config.pet.dailyLimit - usage.count) });
  } catch (err) {
    // A failed attempt doesn't cost the member one of their daily uses.
    await prisma.petUsage.update({ where: { user_id_day: { user_id: userId, day } }, data: { count: { decrement: 1 } } }).catch(() => {});
    if (err instanceof AllProvidersFailed) throw new HttpError(503, 'PET_NAPPING', NAPPING);
    throw err;
  }
};

// --- "What Alfred did" ------------------------------------------------------------------------

export const UNDO_WINDOW_MS = 15 * 60_000;

// Only actions that can be safely reversed are logged: what they do, and what it takes to put it back.
export const petActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('vote'), summary: z.string().trim().min(1).max(140), payload: z.object({ lab_id: z.string().min(1).max(60) }) }),
  z.object({ kind: z.literal('readall'), summary: z.string().trim().min(1).max(140), payload: z.object({ ids: z.array(z.string().min(1).max(60)).max(100) }) }),
]);

const shape = (a: { id: string; kind: string; summary: string; undone_at: Date | null; created_at: Date }, now = Date.now()) => ({
  id: a.id,
  kind: a.kind,
  summary: a.summary,
  created_at: a.created_at,
  undone: a.undone_at !== null,
  can_undo: a.undone_at === null && now - a.created_at.getTime() <= UNDO_WINDOW_MS,
});

export const logAction = async (req: AuthRequest, res: Response): Promise<void> => {
  const { kind, summary, payload } = req.body as z.infer<typeof petActionSchema>;
  const a = await prisma.petAction.create({ data: { user_id: req.userId!, kind, summary, payload } });
  res.status(201).json(shape(a));
};

export const listActions = async (req: AuthRequest, res: Response): Promise<void> => {
  const rows = await prisma.petAction.findMany({ where: { user_id: req.userId }, orderBy: { created_at: 'desc' }, take: 30 });
  res.json({ actions: rows.map((r) => shape(r)), undo_window_minutes: UNDO_WINDOW_MS / 60_000 });
};

export const undoAction = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const userId = req.userId!;
  const a = await prisma.petAction.findFirst({ where: { id, user_id: userId } });
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'That action is not in your log');
  if (a.undone_at) throw new HttpError(409, 'ALREADY_UNDONE', 'That was already undone');
  if (Date.now() - a.created_at.getTime() > UNDO_WINDOW_MS) throw new HttpError(410, 'TOO_LATE', `Undo only works for ${UNDO_WINDOW_MS / 60_000} minutes after Alfred does something`);

  const p = (a.payload ?? {}) as { lab_id?: string; ids?: string[] };
  // Claim the undo first (atomically), so two clicks can't both run it.
  const claimed = await prisma.petAction.updateMany({ where: { id, undone_at: null }, data: { undone_at: new Date() } });
  if (claimed.count === 0) throw new HttpError(409, 'ALREADY_UNDONE', 'That was already undone');

  try {
    switch (a.kind) {
      case 'vote':
        if (p.lab_id) await removeVoteFor(userId, p.lab_id); // only the vote from their current day can be taken back
        break;
      case 'readall':
        if (p.ids?.length) await prisma.notification.updateMany({ where: { id: { in: p.ids }, user_id: userId }, data: { read: false } });
        break;
      default:
        throw new HttpError(400, 'NOT_UNDOABLE', "That can't be undone");
    }
  } catch (err) {
    await prisma.petAction.update({ where: { id }, data: { undone_at: null } }); // it didn't happen, so it isn't undone
    throw err;
  }
  res.json({ message: 'Undone' });
};

// --- what Alfred knows ------------------------------------------------------------------------

/** A few facts about the member themselves (never anyone else), so Alfred can be useful without asking. */
async function buildContext(userId: string): Promise<string> {
  const now = new Date();
  const [me, unread, task, event] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true, streak: true } }),
    prisma.notification.count({ where: { user_id: userId, read: false } }),
    prisma.labTask.findFirst({
      where: { status: { not: 'done' }, due_at: { gt: now }, lab: { members: { some: { user_id: userId } } }, OR: [{ assignee_id: userId }, { assignee_id: null }] },
      orderBy: { due_at: 'asc' },
      include: { lab: { select: { name: true } } },
    }),
    prisma.eventRsvp.findFirst({ where: { user_id: userId, event: { starts_at: { gt: now } } }, orderBy: { event: { starts_at: 'asc' } }, include: { event: { select: { title: true, starts_at: true } } } }),
  ]);
  const lines = [`points: ${me?.points ?? 0}, day streak: ${me?.streak ?? 0}, unread notifications: ${unread}`];
  if (task?.due_at) lines.push(`next task due: "${task.title}" in ${task.lab.name}, ${task.due_at.toISOString().slice(0, 16)}Z`);
  if (event) lines.push(`next event they're going to: "${event.event.title}", ${event.event.starts_at.toISOString().slice(0, 16)}Z`);
  return lines.join('\n');
}

// --- memories ---------------------------------------------------------------------------------

export const listMemories = async (req: AuthRequest, res: Response): Promise<void> => {
  const items = await prisma.petMemory.findMany({ where: { user_id: req.userId }, orderBy: { created_at: 'asc' }, take: MAX_MEMORIES, select: { id: true, text: true, created_at: true } });
  res.json({ memories: items, max: MAX_MEMORIES });
};

export const addMemory = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const { text } = req.body as { text: string };
  // Memories are sent to the AI, so they get the same screening as anything else: no contact details, links or abuse.
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { created_at: true } });
  const check = screenText(text, { accountAgeDays: accountAgeDays(me!.created_at) });
  if (!check.ok && check.code !== 'SELF_HARM') throw new HttpError(422, check.code, check.message);
  if (!check.ok) throw new HttpError(422, 'SELF_HARM', "That's not something I'll store, but I'm here. Talk to a parent, a teacher or someone you trust.");

  if ((await prisma.petMemory.count({ where: { user_id: userId } })) >= MAX_MEMORIES) {
    throw new HttpError(409, 'MEMORY_FULL', `I can remember ${MAX_MEMORIES} things. Forget one first.`);
  }
  const dup = await prisma.petMemory.findFirst({ where: { user_id: userId, text: { equals: text, mode: 'insensitive' } } });
  const m = dup ?? (await prisma.petMemory.create({ data: { user_id: userId, text } }));
  res.status(201).json({ id: m.id, text: m.text, created_at: m.created_at });
};

export const forgetMemory = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id?: string };
  const { count } = await prisma.petMemory.deleteMany({ where: { user_id: req.userId, ...(id ? { id } : {}) } });
  if (id && count === 0) throw new HttpError(404, 'NOT_FOUND', "I don't have that one");
  res.json({ message: id ? 'Forgotten' : 'Forgot everything', forgotten: count });
};
