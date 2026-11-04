import { prisma } from '../db.js';
import { findOpenWindow } from '../lib/admissions.js';
import { sendApplicationReminderOpen } from '../lib/admissionsEmail.js';

const KEEP_SENT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Emails everyone who asked to be told when applications open, once, as soon as a window is open. A request made
 * while no window was scheduled (window_id empty) is answered by whichever window opens next. Each row is claimed
 * before sending so two overlapping runs can never email the same person twice. Sent rows are deleted after 30 days,
 * because the address is only needed until the reminder has gone out.
 */
export async function runApplicationReminders(now: Date = new Date()): Promise<{ sent: number; purged: number }> {
  const purged = await prisma.applicationReminder.deleteMany({ where: { sent_at: { lt: new Date(now.getTime() - KEEP_SENT_MS) } } });
  const open = await findOpenWindow(now);
  if (!open) return { sent: 0, purged: purged.count };

  const due = await prisma.applicationReminder.findMany({ where: { sent_at: null, OR: [{ window_id: open.id }, { window_id: null }] }, take: 200 });
  let sent = 0;
  for (const r of due) {
    const claimed = await prisma.applicationReminder.updateMany({ where: { id: r.id, sent_at: null }, data: { sent_at: now, window_id: open.id } });
    if (claimed.count === 0) continue;
    try {
      await sendApplicationReminderOpen(r.email);
      sent++;
    } catch (err) {
      // Put it back so the next run tries again.
      await prisma.applicationReminder.update({ where: { id: r.id }, data: { sent_at: null } });
      console.error('Application reminder failed:', err);
    }
  }
  return { sent, purged: purged.count };
}

export function startApplicationReminders(intervalMs = 5 * 60_000): () => void {
  const tick = () => runApplicationReminders().catch((err) => console.error('Application reminders failed:', err));
  const first = setTimeout(tick, 45_000);
  const timer = setInterval(tick, intervalMs);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
