import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { dayToDb, localDay } from '../src/lib/day.js';
import { CHALLENGES, WEEKLY_BONUS, challengesForWeek, mondayOf, progressFor } from '../src/lib/weekly.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('weekly calendar', () => {
  it('starts the week on Monday', () => {
    expect(mondayOf('2026-03-09')).toBe('2026-03-09'); // a Monday
    expect(mondayOf('2026-03-11')).toBe('2026-03-09');
    expect(mondayOf('2026-03-15')).toBe('2026-03-09'); // Sunday still belongs to that week
    expect(mondayOf('2026-03-16')).toBe('2026-03-16');
  });

  it('gives everyone the same three different challenges, rotating week to week', () => {
    const a = challengesForWeek('2026-03-09');
    expect(a).toHaveLength(3);
    expect(new Set(a.map((c) => c.key)).size).toBe(3);
    expect(challengesForWeek('2026-03-09')).toEqual(a);
    const seen = new Set<string>();
    for (let w = 0; w < 8; w++) for (const c of challengesForWeek(new Date(Date.UTC(2026, 0, 5) + w * 7 * 86_400_000).toISOString().slice(0, 10))) seen.add(c.key);
    expect(seen.size).toBe(CHALLENGES.length); // every challenge comes round
  });
});

// Does whatever a challenge asks for, straight in the database.
async function satisfy(key: string, me: { user: { id: string } }) {
  const owner = await makeUser();
  const day = (offset: number) => dayToDb(new Date(Date.now() - offset * 86_400_000 * 0).toISOString().slice(0, 10));
  switch (key) {
    case 'back_labs': {
      for (let i = 0; i < 5; i++) { const l = await makeProject(owner.user.id); await prisma.vote.create({ data: { user_id: me.user.id, project_id: l.id, vote_day: dayToDb(localDay(null)) } }); }
      return;
    }
    case 'explore_labs': {
      // three different days, all inside the current week: use today plus earlier days of this week where possible
      const today = localDay(null);
      const monday = mondayOf(today);
      const days = [monday, new Date(Date.parse(`${monday}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), new Date(Date.parse(`${monday}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10)];
      for (const d of days) { const l = await makeProject(owner.user.id); await prisma.vote.create({ data: { user_id: me.user.id, project_id: l.id, vote_day: dayToDb(d) } }); }
      return;
    }
    case 'learn_two': {
      const t = await prisma.track.create({ data: { slug: 't', title: 'T', description: 'd', lessons: { create: [1, 2].map((n) => ({ slug: `l${n}`, title: `L${n}`, summary: 's', body: 'b', position: n })) } }, include: { lessons: true } });
      for (const l of t.lessons) await prisma.lessonProgress.create({ data: { user_id: me.user.id, lesson_id: l.id } });
      return;
    }
    case 'talk_three':
    case 'cheer': {
      const space = await prisma.space.create({ data: { slug: 'g', name: 'G', description: 'x' } });
      const post = await prisma.post.create({ data: { space_id: space.id, author_id: owner.user.id, title: 'Hi', body: 'There' } });
      for (let i = 0; i < 3; i++) await prisma.comment.create({ data: { post_id: post.id, author_id: me.user.id, body: `c${i}` } });
      return;
    }
    case 'ship_updates': {
      const mine = await makeProject(me.user.id);
      await prisma.labMember.create({ data: { lab_id: mine.id, user_id: me.user.id, role: 'owner' } });
      for (let i = 0; i < 2; i++) await prisma.labUpdate.create({ data: { lab_id: mine.id, author_id: me.user.id, title: `U${i}`, body: 'Body' } });
      return;
    }
    case 'start_lab':
      await makeProject(me.user.id);
      return;
    case 'show_up': {
      const ev = await prisma.event.create({ data: { title: 'Lab Night', description: 'x', starts_at: new Date(Date.now() + 86_400_000), created_by: owner.user.id } });
      await prisma.eventRsvp.create({ data: { event_id: ev.id, user_id: me.user.id } });
      return;
    }
  }
  void day;
}

describe('every challenge counts real activity', () => {
  it.each(CHALLENGES.map((c) => [c.key, c.goal] as const))('%s reaches its goal from real activity, and is zero before', async (key, goal) => {
    const me = await makeUser();
    const monday = mondayOf(localDay(null));
    const start = new Date(Date.parse(`${monday}T00:00:00Z`) - 36 * 3_600_000); // generous, covers any timezone
    const w = { monday: dayToDb(monday), start, end: new Date(start.getTime() + 9 * 86_400_000) };
    expect(await progressFor(key, me.user.id, w)).toBe(0);
    await satisfy(key, me);
    expect(await progressFor(key, me.user.id, w)).toBeGreaterThanOrEqual(goal);
  });
});

describe('weekly challenges', () => {
  it('needs a signed-in member and shows three challenges at zero', async () => {
    expect((await request(app).get('/api/v1/rewards/weekly')).status).toBe(401);
    const me = await makeUser();
    const res = await request(app).get('/api/v1/rewards/weekly').set(me.auth);
    expect(res.body.challenges).toHaveLength(3);
    expect(res.body.challenges.every((c: { progress: number; complete: boolean }) => c.progress === 0 && !c.complete)).toBe(true);
    expect(res.body.bonus).toMatchObject({ points: WEEKLY_BONUS, available: false, claimed: false });
  });

  it('pays each challenge once, then the bonus once, and refuses early or unknown claims', async () => {
    const me = await makeUser();
    const week = await request(app).get('/api/v1/rewards/weekly').set(me.auth);
    const keys: string[] = week.body.challenges.map((c: { key: string }) => c.key);
    const claim = (k: string) => request(app).post(`/api/v1/rewards/weekly/${k}/claim`).set(me.auth);

    expect((await claim(keys[0]!)).body.code).toBe('NOT_DONE');
    expect((await claim('nonsense')).status).toBe(404);
    expect((await claim('bonus')).body.code).toBe('NOT_DONE');

    let total = 0;
    for (const k of keys) {
      await satisfy(k, me);
      const done = (await request(app).get('/api/v1/rewards/weekly').set(me.auth)).body.challenges.find((c: { key: string }) => c.key === k);
      expect(done.complete).toBe(true);
      const r = await claim(k);
      expect(r.body.claimed).toBe(true);
      total += r.body.points_awarded;
      expect((await claim(k)).body.code).toBe('ALREADY_CLAIMED');
    }

    const after = await request(app).get('/api/v1/rewards/weekly').set(me.auth);
    expect(after.body.bonus).toMatchObject({ available: true, claimed: false });
    expect((await claim('bonus')).body).toEqual({ claimed: true, points_awarded: WEEKLY_BONUS });
    expect((await claim('bonus')).body.code).toBe('ALREADY_CLAIMED');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: me.user.id } })).points).toBeGreaterThanOrEqual(total + WEEKLY_BONUS);
  });

  it('cannot be double-claimed by simultaneous requests', async () => {
    const me = await makeUser();
    const key: string = (await request(app).get('/api/v1/rewards/weekly').set(me.auth)).body.challenges[0].key;
    await satisfy(key, me);
    const results = await Promise.all([1, 2, 3, 4].map(() => request(app).post(`/api/v1/rewards/weekly/${key}/claim`).set(me.auth)));
    expect(results.filter((r) => r.body.claimed === true)).toHaveLength(1);
    expect(await prisma.weeklyClaim.count({ where: { user_id: me.user.id } })).toBe(1);
  });
});
