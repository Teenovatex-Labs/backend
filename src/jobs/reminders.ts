import { prisma } from '../db.js';
import { createNotification } from '../lib/notify.js';

// Deterministic reminders: a plain scan for things due soon, no AI involved, so they arrive even
// when every AI provider is down. Each item is "claimed" with an atomic update before anyone is
// told, so running this twice (or on two servers) never sends the same reminder twice.

const HOUR = 60 * 60 * 1000;
export const TASK_WINDOW_MS = 24 * HOUR;
export const EVENT_WINDOW_MS = HOUR;

export async function runReminders(now: Date = new Date()): Promise<{ tasks: number; milestones: number; events: number }> {
  const soon = new Date(now.getTime() + TASK_WINDOW_MS);
  let tasks = 0;
  let milestones = 0;
  let events = 0;

  const dueTasks = await prisma.labTask.findMany({
    where: { status: { not: 'done' }, reminded_at: null, due_at: { gt: now, lte: soon } },
    include: { lab: { select: { id: true, name: true, slug: true, user_id: true } } },
  });
  for (const t of dueTasks) {
    const claimed = await prisma.labTask.updateMany({ where: { id: t.id, reminded_at: null }, data: { reminded_at: now } });
    if (claimed.count === 0) continue;
    const who = t.assignee_id ?? t.lab.user_id; // unassigned tasks nudge the owner
    await createNotification(who, 'deadline', `Due soon: "${t.title}" in ${t.lab.name}`, {
      link: `/labs/${t.lab.slug}?tab=board`,
      payload: { task_id: t.id, due_at: t.due_at!.toISOString() },
    });
    tasks++;
  }

  const dueMilestones = await prisma.labMilestone.findMany({
    where: { done_at: null, reminded_at: null, due_at: { gt: now, lte: soon } },
    include: { lab: { select: { id: true, name: true, slug: true } } },
  });
  for (const m of dueMilestones) {
    const claimed = await prisma.labMilestone.updateMany({ where: { id: m.id, reminded_at: null }, data: { reminded_at: now } });
    if (claimed.count === 0) continue;
    const team = await prisma.labMember.findMany({ where: { lab_id: m.lab.id }, select: { user_id: true } });
    for (const { user_id } of team) {
      await createNotification(user_id, 'deadline', `Milestone due soon in ${m.lab.name}: ${m.title}`, { link: `/labs/${m.lab.slug}`, payload: { milestone_id: m.id, due_at: m.due_at!.toISOString() } });
    }
    milestones++;
  }

  const startingSoon = await prisma.eventRsvp.findMany({
    where: { reminded_at: null, event: { starts_at: { gt: now, lte: new Date(now.getTime() + EVENT_WINDOW_MS) } } },
    include: { event: { select: { id: true, title: true, starts_at: true } } },
  });
  for (const r of startingSoon) {
    const claimed = await prisma.eventRsvp.updateMany({ where: { event_id: r.event_id, user_id: r.user_id, reminded_at: null }, data: { reminded_at: now } });
    if (claimed.count === 0) continue;
    await createNotification(r.user_id, 'event', `Starting soon: ${r.event.title}`, { link: `/events/${r.event.id}`, payload: { event_id: r.event.id, starts_at: r.event.starts_at.toISOString() } });
    events++;
  }

  return { tasks, milestones, events };
}

/** Starts the every-five-minutes scan. Returns a stop function. */
export function startReminders(intervalMs = 5 * 60_000): () => void {
  const tick = () => runReminders().catch((err) => console.error('Reminder scan failed:', err));
  const first = setTimeout(tick, 15_000); // shortly after boot, not during it
  const timer = setInterval(tick, intervalMs);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
