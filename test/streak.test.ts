import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { recordDailyLogin } from '../src/lib/streak.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const at = (iso: string) => new Date(iso);
const reload = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });

describe('daily streak', () => {
  it('starts at 1 on the first visit and pays 3 points', async () => {
    const { user } = await makeUser();
    expect(await recordDailyLogin(user, at('2026-03-10T09:00:00Z'))).toBe(1);
    expect((await reload(user.id)).points).toBe(3);
  });

  it('does nothing on a second visit the same day', async () => {
    const { user } = await makeUser();
    await recordDailyLogin(user, at('2026-03-10T09:00:00Z'));
    const again = await recordDailyLogin(await reload(user.id), at('2026-03-10T20:00:00Z'));
    expect(again).toBe(1);
    expect((await reload(user.id)).points).toBe(3);
  });

  it('grows on the next day and resets after a missed day', async () => {
    const { user } = await makeUser();
    await recordDailyLogin(user, at('2026-03-10T09:00:00Z'));
    expect(await recordDailyLogin(await reload(user.id), at('2026-03-11T09:00:00Z'))).toBe(2);
    expect(await recordDailyLogin(await reload(user.id), at('2026-03-14T09:00:00Z'))).toBe(1);
  });

  it('follows the member’s own midnight, not the server’s', async () => {
    // 23:30 and 00:30 Lagos time are only an hour apart, but they are different days there.
    const { user } = await makeUser({ timezone: 'Africa/Lagos' });
    await recordDailyLogin(user, at('2026-03-10T21:30:00Z')); // 22:30 Lagos, 10 March
    expect(await recordDailyLogin(await reload(user.id), at('2026-03-10T23:30:00Z'))).toBe(2); // 00:30, 11 March
  });

  it('adds a 25 point bonus every 7th day', async () => {
    const { user } = await makeUser({ streak: 6, last_login_at: at('2026-03-10T09:00:00Z') });
    expect(await recordDailyLogin(user, at('2026-03-11T09:00:00Z'))).toBe(7);
    expect((await reload(user.id)).points).toBe(28);
  });
});
