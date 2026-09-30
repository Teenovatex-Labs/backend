import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const makeSpace = (slug = 'general') => prisma.space.create({ data: { slug, name: 'General', description: 'Anything goes (kindly)' } });
const oldUser = (over = {}) => makeUser({ created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), ...over });
const post = (slug: string, auth: Record<string, string>, body: object) => request(app).post(`/api/v1/community/spaces/${slug}/posts`).set(auth).send(body);

describe('community posts', () => {
  it('lists spaces, lets members post, and shows the post in the feed', async () => {
    await makeSpace();
    const me = await oldUser();
    const created = await post('general', me.auth, { title: 'Hello world', body: 'My first post here' });
    expect(created.status).toBe(201);

    const spaces = await request(app).get('/api/v1/community/spaces');
    expect(spaces.body.spaces[0]).toMatchObject({ slug: 'general', post_count: 1 });

    const feed = await request(app).get('/api/v1/community/spaces/general/posts').set(me.auth);
    expect(feed.body.posts).toHaveLength(1);
    expect(feed.body.posts[0]).toMatchObject({ title: 'Hello world', comment_count: 0, has_reacted: false });
    expect((await request(app).get('/api/v1/community/spaces/none/posts')).status).toBe(404);
  });

  it('needs a signed-in, active member', async () => {
    await makeSpace();
    expect((await request(app).post('/api/v1/community/spaces/general/posts').send({ title: 'abc', body: 'abcd' })).status).toBe(401);
    const noAge = await makeUser({ birth_date: null });
    expect((await post('general', noAge.auth, { title: 'abc', body: 'abcd' })).body.code).toBe('AGE_REQUIRED');
    const paused = await makeUser({ suspended_until: new Date(Date.now() + 86400000) });
    expect((await post('general', paused.auth, { title: 'abc', body: 'abcd' })).body.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('refuses what the content filter refuses, without storing it', async () => {
    await makeSpace();
    const me = await oldUser();
    const phone = await post('general', me.auth, { title: 'Call me', body: 'my number is 0803 555 1234' });
    expect(phone.status).toBe(422);
    expect(phone.body.code).toBe('PERSONAL_INFO');
    expect((await post('general', me.auth, { title: 'hey', body: 'dm me on snap' })).body.code).toBe('OFF_PLATFORM');
    expect((await post('general', me.auth, { title: 'rude', body: 'this is shit' })).body.code).toBe('ABUSIVE_LANGUAGE');
    expect(await prisma.post.count()).toBe(0);
  });

  it('answers self-harm with support and quietly flags it for a moderator', async () => {
    await makeSpace();
    const me = await oldUser();
    const res = await post('general', me.auth, { title: 'I am so tired', body: 'sometimes I want to die' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SELF_HARM');
    expect(res.body.error).toMatch(/988/);
    expect(await prisma.post.count()).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'filter.self_harm' } });
    expect(log.actor_id).toBe(me.user.id);
  });

  it('keeps links off brand-new accounts but allows them after a few days', async () => {
    await makeSpace();
    const fresh = await makeUser();
    const link = { title: 'Cool site', body: 'look at https://example.com/x' };
    expect((await post('general', fresh.auth, link)).body.code).toBe('LINKS_NOT_ALLOWED');
    const settled = await oldUser();
    expect((await post('general', settled.auth, link)).status).toBe(201);
  });

  it('lets an author delete their own post, and nobody else', async () => {
    await makeSpace();
    const me = await oldUser();
    const other = await oldUser();
    const { body } = await post('general', me.auth, { title: 'Mine', body: 'Delete me please' });
    expect((await request(app).delete(`/api/v1/community/posts/${body.id}`).set(other.auth)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/community/posts/${body.id}`).set(me.auth)).status).toBe(200);
    expect(await prisma.post.count()).toBe(0);
  });

  it('stops after 10 posts in a day', async () => {
    await makeSpace();
    const me = await oldUser();
    for (let i = 0; i < 10; i++) await prisma.post.create({ data: { space_id: (await prisma.space.findFirstOrThrow()).id, author_id: me.user.id, title: `p${i}`, body: 'text body' } });
    expect((await post('general', me.auth, { title: 'one more', body: 'text body' })).body.code).toBe('POST_LIMIT');
  });
});

describe('comments and reactions', () => {
  it('comments, counts, notifies the author, and deletes', async () => {
    await makeSpace();
    const author = await oldUser();
    const reader = await oldUser();
    const { body: p } = await post('general', author.auth, { title: 'Question', body: 'How do I centre a div?' });

    const c = await request(app).post(`/api/v1/community/posts/${p.id}/comments`).set(reader.auth).send({ body: 'Use flexbox!' });
    expect(c.status).toBe(201);
    const shown = await request(app).get(`/api/v1/community/posts/${p.id}`).set(reader.auth);
    expect(shown.body.comment_count).toBe(1);
    expect(shown.body.comments[0]).toMatchObject({ body: 'Use flexbox!' });

    const note = await prisma.notification.findFirstOrThrow({ where: { user_id: author.user.id, type: 'comment' } });
    expect(note.link).toBe(`/community/posts/${p.id}`);

    expect((await request(app).delete(`/api/v1/community/comments/${c.body.id}`).set(author.auth)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/community/comments/${c.body.id}`).set(reader.auth)).status).toBe(200);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).comment_count).toBe(0);
  });

  it('filters comments too', async () => {
    await makeSpace();
    const a = await oldUser();
    const { body: p } = await post('general', a.auth, { title: 'Hello', body: 'Some words here' });
    const res = await request(app).post(`/api/v1/community/posts/${p.id}/comments`).set(a.auth).send({ body: 'email me at bob@example.com' });
    expect(res.body.code).toBe('PERSONAL_INFO');
  });

  it('toggles a reaction once per member, even when clicked together', async () => {
    await makeSpace();
    const a = await oldUser();
    const fan = await oldUser();
    const { body: p } = await post('general', a.auth, { title: 'Nice', body: 'Look at this thing' });
    await Promise.all([1, 2, 3].map(() => request(app).post(`/api/v1/community/posts/${p.id}/react`).set(fan.auth)));
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).reaction_count).toBe(1);
    const off = await request(app).delete(`/api/v1/community/posts/${p.id}/react`).set(fan.auth);
    expect(off.body).toMatchObject({ reaction_count: 0, has_reacted: false });
  });

  it('hides blocked members from each other, both ways', async () => {
    await makeSpace();
    const a = await oldUser();
    const b = await oldUser();
    const { body: p } = await post('general', a.auth, { title: 'Mine', body: 'Only some can see' });
    await request(app).post(`/api/v1/blocks/${a.user.username}`).set(b.auth);

    expect((await request(app).get('/api/v1/community/spaces/general/posts').set(b.auth)).body.posts).toHaveLength(0);
    expect((await request(app).get(`/api/v1/community/posts/${p.id}`).set(b.auth)).status).toBe(404);
    expect((await request(app).get('/api/v1/community/spaces/general/posts').set(a.auth)).body.posts).toHaveLength(1);
    expect((await request(app).post(`/api/v1/community/posts/${p.id}/comments`).set(b.auth).send({ body: 'hi there' })).status).toBe(404);
  });
});
