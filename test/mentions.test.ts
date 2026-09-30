import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { extractMentions } from '../src/lib/mentions.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const old = { created_at: new Date(Date.now() - 30 * 86400000) };
const mentions = (id: string) => prisma.notification.findMany({ where: { user_id: id, type: 'mention' } });

describe('extracting mentions', () => {
  it('finds @names, ignores emails and repeats, keeps order', () => {
    expect(extractMentions('hi @sam_dev and @Alex, also @sam_dev again')).toEqual(['sam_dev', 'Alex']);
    expect(extractMentions('mail a@b.com or me@@x, @ab too short')).toEqual([]);
    expect(extractMentions('(@sam_dev)')).toEqual(['sam_dev']);
    expect(extractMentions('@sam_dev at the start')).toEqual(['sam_dev']);
  });
});

describe('mentions', () => {
  const setup = async () => {
    const space = await prisma.space.create({ data: { slug: 'g', name: 'General', description: 'x' } });
    return { space, author: await makeUser(old), friend: await makeUser(old) };
  };
  const post = (auth: Record<string, string>, body: string) => request(app).post('/api/v1/community/spaces/g/posts').set(auth).send({ title: 'Hello there', body });

  it('notify the person named in a post, with a link to it', async () => {
    const { author, friend } = await setup();
    const res = await post(author.auth, `thoughts, @${friend.user.username}?`);
    const [n] = await mentions(friend.user.id);
    expect(n!.message).toContain(`@${author.user.username} mentioned you`);
    expect(n!.link).toBe(`/community/posts/${res.body.id}`);
  });

  it('notify from comments and lab updates too', async () => {
    const { author, friend } = await setup();
    const { body: p } = await post(author.auth, 'plain post here');
    await request(app).post(`/api/v1/community/posts/${p.id}/comments`).set(author.auth).send({ body: `ping @${friend.user.username}` });
    const lab = await makeProject(author.user.id);
    await prisma.labMember.create({ data: { lab_id: lab.id, user_id: author.user.id, role: 'owner' } });
    await request(app).post(`/api/v1/projects/${lab.id}/updates`).set(author.auth).send({ title: 'Week one', body: `thanks @${friend.user.username}` });
    expect(await mentions(friend.user.id)).toHaveLength(2);
  });

  it('never notify yourself, people who do not exist, or anyone blocked either way', async () => {
    const { author, friend } = await setup();
    const blocker = await makeUser(old);
    await prisma.block.create({ data: { blocker_id: blocker.user.id, blocked_id: author.user.id } });
    const iBlocked = await makeUser(old);
    await prisma.block.create({ data: { blocker_id: author.user.id, blocked_id: iBlocked.user.id } });
    await post(author.auth, `@${author.user.username} @${blocker.user.username} @${iBlocked.user.username} @nobody_here @${friend.user.username}`);
    expect(await mentions(author.user.id)).toHaveLength(0);
    expect(await mentions(blocker.user.id)).toHaveLength(0);
    expect(await mentions(iBlocked.user.id)).toHaveLength(0);
    expect(await mentions(friend.user.id)).toHaveLength(1);
  });

  it('are capped at five people per post', async () => {
    const { author } = await setup();
    const crowd = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(() => makeUser(old)));
    await post(author.auth, crowd.map((c) => `@${c.user.username}`).join(' '));
    expect(await prisma.notification.count({ where: { type: 'mention' } })).toBe(5);
  });
});
