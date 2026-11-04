import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { rank, weightedTotal } from '../src/lib/challenges.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const DAY = 86_400_000;
const A = '/api/v1/admin/challenges';
const criteria = [{ name: 'Creativity', weight: 2 }, { name: 'Impact', weight: 1 }];
const make = (admin: { auth: object }, over: Record<string, unknown> = {}) =>
  request(app).post(A).set(admin.auth as Record<string, string>).send({
    title: 'Build for good', description: 'Make something that helps your community.', rules: 'Original work only. One entry each.',
    kind: 'special', starts_at: new Date(Date.now() - DAY).toISOString(), ends_at: new Date(Date.now() + DAY).toISOString(),
    judging_ends_at: new Date(Date.now() + 3 * DAY).toISOString(), criteria, ...over,
  });
const open = async (admin: { auth: object }, over: Record<string, unknown> = {}) => {
  const id = (await make(admin, over)).body.id as string;
  await request(app).post(`${A}/${id}/status`).set(admin.auth as Record<string, string>).send({ to: 'open' });
  return id;
};
const enter = (m: { auth: object }, id: string, title = 'My idea') =>
  request(app).post(`/api/v1/challenges/${id}/entries`).set(m.auth as Record<string, string>).send({ title, body: 'A description of what I built and why.' });

describe('scoring math', () => {
  it('weights criteria and ranks ties together', () => {
    expect(weightedTotal(criteria, { Creativity: 9, Impact: 6 })).toBe(800);
    const r = rank([{ entryId: 'a', userId: '1', total: 900 }, { entryId: 'b', userId: '2', total: 900 }, { entryId: 'c', userId: '3', total: 700 }]);
    expect(r.map((x) => x.place)).toEqual([1, 1, 3]);
  });
});

describe('setup and entering', () => {
  it('is staff-only, validates dates, and hides drafts from members', async () => {
    const admin = await makeUser({ role: 'admin' });
    const member = await makeUser();
    expect((await make(member)).status).toBe(403);
    expect((await make(admin, { ends_at: new Date(Date.now() - 2 * DAY).toISOString() })).status).toBe(400);
    const id = (await make(admin)).body.id;
    expect((await request(app).get(`/api/v1/challenges/${id}`).set(member.auth)).status).toBe(404);
    await request(app).post(`${A}/${id}/status`).set(admin.auth).send({ to: 'open' });
    expect((await request(app).get(`/api/v1/challenges/${id}`).set(member.auth)).body.accepting_entries).toBe(true);
  });

  it('enforces the entry limit, edit rules and withdrawing', async () => {
    const admin = await makeUser({ role: 'admin' });
    const m = await makeUser();
    const id = await open(admin);
    const first = await enter(m, id);
    expect(first.status).toBe(201);
    expect((await enter(m, id)).body.code).toBe('ENTRY_LIMIT');
    const edit = await request(app).patch(`/api/v1/challenges/entries/${first.body.id}`).set(m.auth).send({ title: 'Better title' });
    expect(edit.body.title).toBe('Better title');
    await request(app).delete(`/api/v1/challenges/entries/${first.body.id}`).set(m.auth);
    expect((await enter(m, id)).status).toBe(201);
  });

  it('refuses entries outside the open window', async () => {
    const admin = await makeUser({ role: 'admin' });
    const m = await makeUser();
    const id = await open(admin, { starts_at: new Date(Date.now() + DAY).toISOString(), ends_at: new Date(Date.now() + 2 * DAY).toISOString() });
    expect((await enter(m, id)).body.code).toBe('CHALLENGE_NOT_OPEN');
  });

  it('locks criteria once open', async () => {
    const admin = await makeUser({ role: 'admin' });
    const id = await open(admin);
    const res = await request(app).patch(`${A}/${id}`).set(admin.auth).send({ criteria: [{ name: 'Only', weight: 1 }] });
    expect(res.body.code).toBe('CHALLENGE_LOCKED');
  });
});

describe('judging and publishing', () => {
  const setup = async () => {
    const admin = await makeUser({ role: 'admin' });
    const judge = await makeUser({ role: 'admin' });
    const [a, b, c, d] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
    const badge = await prisma.badgeDefinition.create({ data: { slug: 'champ', name: 'Champion', description: 'Won a challenge', criteria_text: 'Placed first in a judged challenge', tier: 'high' } });
    const id = await open(admin, { badge_id: badge.id });
    const entries = [] as string[];
    for (const m of [a, b, c, d]) entries.push((await enter(m, id)).body.id);
    await request(app).post(`${A}/${id}/status`).set(admin.auth).send({ to: 'judging' });
    const score = (who: { auth: object }, entry: string, s: [number, number]) =>
      request(app).put(`${A}/${id}/entries/${entry}/score`).set(who.auth as Record<string, string>).send({ scores: { Creativity: s[0], Impact: s[1] } });
    return { admin, judge, members: [a, b, c, d], id, entries, badge, score };
  };

  it('scores, ranks with ties, awards points and the badge once, and is idempotent', async () => {
    const { admin, judge, members, id, entries, badge, score } = await setup();
    expect((await request(app).get(`${A}/${id}/entries`).set(judge.auth)).body.items).toHaveLength(4);
    await score(judge, entries[0], [9, 9]);
    await score(judge, entries[1], [9, 9]);
    await score(judge, entries[2], [5, 5]);
    expect((await request(app).post(`${A}/${id}/publish-results`).set(admin.auth)).body.code).toBe('UNSCORED_ENTRIES');
    await score(judge, entries[3], [2, 2]);

    const pub = await request(app).post(`${A}/${id}/publish-results`).set(admin.auth);
    expect(pub.status).toBe(201);
    const again = await request(app).post(`${A}/${id}/publish-results`).set(admin.auth);
    expect(again.body.already_published).toBe(true);

    const places = await prisma.challengeResult.findMany({ orderBy: { place: 'asc' } });
    expect(places.map((p) => p.place)).toEqual([1, 1, 3, 4]);
    expect(await prisma.badgeAward.count({ where: { badge_id: badge.id, challenge_id: id } })).toBe(2);
    const tied = await prisma.user.findUniqueOrThrow({ where: { id: members[0].user.id } });
    expect(tied.points).toBe(5000); // 50 points, once
    expect((await prisma.user.findUniqueOrThrow({ where: { id: members[2].user.id } })).points).toBe(2000);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: members[3].user.id } })).points).toBe(0);
    expect(await prisma.notification.count({ where: { type: 'challenge' } })).toBe(4);

    const view = await request(app).get(`/api/v1/challenges/${id}`).set(members[3].auth);
    expect(view.body.podium).toHaveLength(3);
    expect(view.body.my_results[0].place).toBe(4);
  });

  it('blocks scoring your own entry and publishing when you placed', async () => {
    const admin = await makeUser({ role: 'admin' });
    const other = await makeUser();
    const id = await open(admin);
    const mine = (await enter(admin, id)).body.id;
    const theirs = (await enter(other, id)).body.id;
    await request(app).post(`${A}/${id}/status`).set(admin.auth).send({ to: 'judging' });
    const own = await request(app).put(`${A}/${id}/entries/${mine}/score`).set(admin.auth).send({ scores: { Creativity: 10, Impact: 10 } });
    expect(own.body.code).toBe('CONFLICT_OF_INTEREST');
    const judge = await makeUser({ role: 'admin' });
    await request(app).put(`${A}/${id}/entries/${mine}/score`).set(judge.auth).send({ scores: { Creativity: 10, Impact: 10 } });
    await request(app).put(`${A}/${id}/entries/${theirs}/score`).set(judge.auth).send({ scores: { Creativity: 1, Impact: 1 } });
    const pub = await request(app).post(`${A}/${id}/publish-results`).set(admin.auth);
    expect(pub.body.code).toBe('CONFLICT_OF_INTEREST');
    expect(await prisma.challengeResult.count()).toBe(0);
    expect((await prisma.challenge.findUniqueOrThrow({ where: { id } })).status).toBe('judging');
    expect((await request(app).post(`${A}/${id}/publish-results`).set(judge.auth)).status).toBe(201);
  });

  it('rejects incomplete scores and scoring outside judging; disqualified entries drop out', async () => {
    const { judge, admin, id, entries, score } = await setup();
    const bad = await request(app).put(`${A}/${id}/entries/${entries[0]}/score`).set(judge.auth).send({ scores: { Creativity: 5 } });
    expect(bad.status).toBe(400);
    await request(app).post(`${A}/${id}/entries/${entries[3]}/disqualify`).set(admin.auth).send({ reason: 'Not original work' });
    expect((await request(app).get(`${A}/${id}/entries`).set(judge.auth)).body.items).toHaveLength(3);
    await score(judge, entries[0], [8, 8]);
    expect((await request(app).get(`${A}/${id}/standings`).set(judge.auth)).body.unscored_entries).toBe(2);
  });
});
