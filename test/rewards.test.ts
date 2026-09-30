import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { BADGES, checkBadges } from '../src/lib/badges.js';
import { levelFor } from '../src/lib/levels.js';
import { QUESTS, questForDay } from '../src/lib/quests.js';
import { recordDailyLogin } from '../src/lib/streak.js';
import { dayToDb, localDay } from '../src/lib/day.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const flush = () => new Promise((r) => setTimeout(r, 120)); // badge checks after a request run in the background
const badgeKeys = async (id: string) => (await prisma.userBadge.findMany({ where: { user_id: id } })).map((b) => b.key).sort();

describe('levels', () => {
  it('follow points, with a playful title and progress to the next', () => {
    expect(levelFor(0)).toMatchObject({ level: 1, title: 'Spark', next_at: 20, progress: 0 });
    expect(levelFor(19).level).toBe(1);
    expect(levelFor(20)).toMatchObject({ level: 2, title: 'Tinkerer' });
    expect(levelFor(40).progress).toBeCloseTo(0.5);
    expect(levelFor(5000)).toMatchObject({ level: 10, title: 'Legend', next_at: null, progress: 1 });
    expect(levelFor(-5).level).toBe(1);
  });

  it('are shown on the member and on their public profile', async () => {
    const me = await makeUser({ points: 130 });
    expect((await request(app).get('/api/v1/users/me').set(me.auth)).body.level).toMatchObject({ level: 4, title: 'Builder' });
    expect((await request(app).get(`/api/v1/users/${me.user.username}`)).body.level.title).toBe('Builder');
  });
});

describe('badges', () => {
  it('are earned from real activity, once, with a notification', async () => {
    const me = await makeUser();
    expect(await checkBadges(me.user.id)).toEqual([]);
    await makeProject(me.user.id);
    const first = await checkBadges(me.user.id);
    expect(first.map((b) => b.key)).toEqual(['first_lab']);
    expect(await checkBadges(me.user.id)).toEqual([]); // nothing new, nothing repeated
    expect(await prisma.notification.count({ where: { user_id: me.user.id, type: 'badge' } })).toBe(1);
  });

  it('arrive by themselves after doing the thing, and show on the profile', async () => {
    const owner = await makeUser();
    const voter = await makeUser();
    const lab = await makeProject(owner.user.id);
    await request(app).post(`/api/v1/projects/${lab.id}/vote`).set(voter.auth);
    await flush();
    expect(await badgeKeys(voter.user.id)).toEqual(['first_vote']);
    const profile = await request(app).get(`/api/v1/users/${voter.user.username}`);
    expect(profile.body.badges).toEqual([expect.objectContaining({ key: 'first_vote', title: 'Supporter' })]);
  });

  it('includes every kind: lesson, track, community, teams, milestones, friends, popularity', async () => {
    const me = await makeUser({ streak: 7 });
    const other = await makeUser();
    const track = await prisma.track.create({ data: { slug: 't', title: 'T', description: 'd', lessons: { create: [{ slug: 'a', title: 'A', summary: 's', body: 'b', position: 1 }] } }, include: { lessons: true } });
    await prisma.lessonProgress.create({ data: { user_id: me.user.id, lesson_id: track.lessons[0]!.id } });
    const space = await prisma.space.create({ data: { slug: 'g', name: 'G', description: 'x' } });
    await prisma.post.create({ data: { space_id: space.id, author_id: me.user.id, title: 'Hello', body: 'World' } });
    const theirLab = await makeProject(other.user.id);
    await prisma.labMember.create({ data: { lab_id: theirLab.id, user_id: me.user.id } });
    await prisma.labMilestone.create({ data: { lab_id: theirLab.id, title: 'Done', done_at: new Date() } });
    await prisma.follow.createMany({ data: [{ follower_id: me.user.id, following_id: other.user.id }, { follower_id: other.user.id, following_id: me.user.id }] });
    await makeProject(me.user.id, { vote_count: 10 });

    await checkBadges(me.user.id);
    expect(await badgeKeys(me.user.id)).toEqual(['first_comment', 'first_lab', 'first_lesson', 'friend', 'loved_10', 'milestone', 'streak_3', 'streak_7', 'team_player', 'track_done']);
  });

  it('are listed for the member, earned or not', async () => {
    const me = await makeUser();
    await makeProject(me.user.id);
    await checkBadges(me.user.id);
    const res = await request(app).get('/api/v1/rewards/badges').set(me.auth);
    expect(res.body.badges).toHaveLength(BADGES.length);
    expect(res.body.badges.find((b: { key: string }) => b.key === 'first_lab')).toMatchObject({ earned: true });
    expect(res.body.badges.find((b: { key: string }) => b.key === 'streak_30')).toMatchObject({ earned: false, awarded_at: null });
  });

  it('are awarded only once when checks run at the same time', async () => {
    const me = await makeUser();
    await makeProject(me.user.id);
    await Promise.all([1, 2, 3, 4].map(() => checkBadges(me.user.id)));
    expect(await prisma.userBadge.count({ where: { user_id: me.user.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { user_id: me.user.id, type: 'badge' } })).toBe(1);
  });
});

describe('the daily quest', () => {
  it('is the same for everyone on a day, and cycles through all of them', () => {
    expect(questForDay('2026-03-10')).toEqual(questForDay('2026-03-10'));
    const week = Array.from({ length: QUESTS.length }, (_, i) => questForDay(`2026-03-${10 + i}`).key);
    expect(new Set(week).size).toBe(QUESTS.length);
  });

  const today = () => questFor();
  const questFor = async () => questForDay(localDay(null));

  it('shows progress, can be claimed only when done, and pays once', async () => {
    const me = await makeUser();
    const q = await today();
    const start = await request(app).get('/api/v1/rewards/quest').set(me.auth);
    expect(start.body).toMatchObject({ key: q.key, progress: 0, complete: false, claimed: false });
    const early = await request(app).post('/api/v1/rewards/quest/claim').set(me.auth);
    expect(early.body.code).toBe('NOT_DONE');

    // Do whatever today's quest asks, straight in the database.
    const owner = await makeUser();
    const labs = [await makeProject(owner.user.id), await makeProject(owner.user.id)];
    const space = await prisma.space.create({ data: { slug: 'g', name: 'G', description: 'x' } });
    const track = await prisma.track.create({ data: { slug: 't', title: 'T', description: 'd', lessons: { create: [{ slug: 'a', title: 'A', summary: 's', body: 'b', position: 1 }] } }, include: { lessons: true } });
    if (q.key === 'vote' || q.key === 'explore') for (const l of labs.slice(0, q.goal)) await prisma.vote.create({ data: { user_id: me.user.id, project_id: l.id, vote_day: dayToDb(localDay(null)) } });
    if (q.key === 'lesson') await prisma.lessonProgress.create({ data: { user_id: me.user.id, lesson_id: track.lessons[0]!.id } });
    if (q.key === 'talk') await prisma.post.create({ data: { space_id: space.id, author_id: me.user.id, title: 'Hi', body: 'There' } });
    if (q.key === 'build') { const mine = await makeProject(me.user.id); await prisma.labMember.create({ data: { lab_id: mine.id, user_id: me.user.id, role: 'owner' } }); await prisma.labUpdate.create({ data: { lab_id: mine.id, author_id: me.user.id, title: 'Update', body: 'Body' } }); }

    const done = await request(app).get('/api/v1/rewards/quest').set(me.auth);
    expect(done.body).toMatchObject({ complete: true, progress: q.goal });
    const claim = await request(app).post('/api/v1/rewards/quest/claim').set(me.auth);
    expect(claim.body).toEqual({ claimed: true, points_awarded: 5 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: me.user.id } })).points).toBe(5);
    expect((await prisma.pointsLog.findFirstOrThrow({ where: { user_id: me.user.id } })).kind).toBe('quest');
    expect((await request(app).post('/api/v1/rewards/quest/claim').set(me.auth)).body.code).toBe('ALREADY_CLAIMED');
  });

  it('cannot be double-claimed by simultaneous requests', async () => {
    const me = await makeUser();
    const q = questForDay(localDay(null));
    // Make it complete whatever today's quest is, by stamping a claim-eligible state directly.
    const owner = await makeUser();
    const lab = await makeProject(owner.user.id);
    const lab2 = await makeProject(owner.user.id);
    const space = await prisma.space.create({ data: { slug: 'g', name: 'G', description: 'x' } });
    const track = await prisma.track.create({ data: { slug: 't', title: 'T', description: 'd', lessons: { create: [{ slug: 'a', title: 'A', summary: 's', body: 'b', position: 1 }] } }, include: { lessons: true } });
    await prisma.vote.createMany({ data: [lab, lab2].map((l) => ({ user_id: me.user.id, project_id: l.id, vote_day: dayToDb(localDay(null)) })) });
    await prisma.lessonProgress.create({ data: { user_id: me.user.id, lesson_id: track.lessons[0]!.id } });
    await prisma.post.create({ data: { space_id: space.id, author_id: me.user.id, title: 'Hi', body: 'There' } });
    const mine = await makeProject(me.user.id);
    await prisma.labMember.create({ data: { lab_id: mine.id, user_id: me.user.id, role: 'owner' } });
    await prisma.labUpdate.create({ data: { lab_id: mine.id, author_id: me.user.id, title: 'Update', body: 'Body' } });
    void q;

    const results = await Promise.all([1, 2, 3, 4].map(() => request(app).post('/api/v1/rewards/quest/claim').set(me.auth)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: me.user.id } })).points).toBe(5);
  });
});

describe('streak freezes', () => {
  const at = (iso: string) => new Date(iso);
  const reload = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });

  it('are earned on every 7th day, up to two', async () => {
    const { user } = await makeUser({ streak: 6, last_login_at: at('2026-03-10T09:00:00Z') });
    await recordDailyLogin(user, at('2026-03-11T09:00:00Z'));
    expect((await reload(user.id)).streak_freezes).toBe(1);

    const { user: rich } = await makeUser({ streak: 13, streak_freezes: 2, last_login_at: at('2026-03-10T09:00:00Z') });
    await recordDailyLogin(rich, at('2026-03-11T09:00:00Z'));
    expect((await reload(rich.id)).streak_freezes).toBe(2); // capped
  });

  it('save a streak after exactly one missed day, and are spent doing it', async () => {
    const { user } = await makeUser({ streak: 5, streak_freezes: 1, last_login_at: at('2026-03-10T09:00:00Z') });
    await recordDailyLogin(user, at('2026-03-12T09:00:00Z')); // missed the 11th
    const after = await reload(user.id);
    expect(after.streak).toBe(6);
    expect(after.streak_freezes).toBe(0);
    expect(await prisma.notification.count({ where: { user_id: user.id, type: 'streak' } })).toBe(1);
  });

  it('do not help after two missed days, or without one saved', async () => {
    const { user: long } = await makeUser({ streak: 5, streak_freezes: 1, last_login_at: at('2026-03-10T09:00:00Z') });
    await recordDailyLogin(long, at('2026-03-13T09:00:00Z'));
    expect((await reload(long.id)).streak).toBe(1);
    expect((await reload(long.id)).streak_freezes).toBe(1); // untouched: it wasn't used

    const { user: none } = await makeUser({ streak: 5, streak_freezes: 0, last_login_at: at('2026-03-10T09:00:00Z') });
    await recordDailyLogin(none, at('2026-03-12T09:00:00Z'));
    expect((await reload(none.id)).streak).toBe(1);
  });

  it('are shown to the member', async () => {
    const me = await makeUser({ streak_freezes: 2 });
    expect((await request(app).get('/api/v1/users/me').set(me.auth)).body.streak_freezes).toBe(2);
  });
});
