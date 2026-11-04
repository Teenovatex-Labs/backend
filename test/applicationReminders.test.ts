import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db.js';
import { runApplicationReminders } from '../src/jobs/applicationReminders.js';
import { resetDb } from './helpers.js';

const sent = vi.hoisted(() => ({ to: [] as string[], fail: false }));
vi.mock('../src/lib/admissionsEmail.js', () => ({
  sendApplicationReminderOpen: async (e: string) => { if (sent.fail) throw new Error('mail down'); sent.to.push(e); },
}));

beforeEach(async () => { await resetDb(); sent.to.length = 0; sent.fail = false; });
afterAll(() => prisma.$disconnect());

const DAY = 86_400_000;
const win = (opens: number, closes: number) =>
  prisma.applicationWindow.create({ data: { opens_at: new Date(Date.now() + opens * DAY), closes_at: new Date(Date.now() + closes * DAY), decisions_publish_at: new Date(Date.now() + (closes + 5) * DAY), form_version: 'v1' } });

describe('application reminders', () => {
  it('sends nothing until a window is open, then sends once', async () => {
    const w = await win(3, 10);
    await prisma.applicationReminder.createMany({ data: [{ email: 'a@example.com', window_id: w.id }, { email: 'b@example.com', window_id: null }] });
    expect((await runApplicationReminders()).sent).toBe(0);
    await prisma.applicationWindow.update({ where: { id: w.id }, data: { opens_at: new Date(Date.now() - DAY) } });
    expect((await runApplicationReminders()).sent).toBe(2);
    expect(sent.to.sort()).toEqual(['a@example.com', 'b@example.com']);
    expect((await runApplicationReminders()).sent).toBe(0);
  });

  it('retries after a mail failure and purges old sent rows', async () => {
    const w = await win(-1, 5);
    await prisma.applicationReminder.create({ data: { email: 'c@example.com', window_id: w.id } });
    sent.fail = true;
    expect((await runApplicationReminders()).sent).toBe(0);
    expect((await prisma.applicationReminder.findFirstOrThrow()).sent_at).toBeNull();
    sent.fail = false;
    expect((await runApplicationReminders()).sent).toBe(1);
    await prisma.applicationReminder.updateMany({ data: { sent_at: new Date(Date.now() - 40 * DAY) } });
    expect((await runApplicationReminders()).purged).toBe(1);
  });
});
