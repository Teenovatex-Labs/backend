import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const old = { created_at: new Date(Date.now() - 30 * 86400000) };
const follow = async (a: { auth: Record<string, string> }, b: { user: { username: string } }) =>
  request(app).post(`/api/v1/users/${b.user.username}/follow`).set(a.auth);
const friends = async () => {
  const a = await makeUser(old);
  const b = await makeUser(old);
  await follow(a, b);
  await follow(b, a);
  return { a, b };
};
const open = (from: { auth: Record<string, string> }, to: { user: { username: string } }) =>
  request(app).post('/api/v1/messages/conversations').set(from.auth).send({ username: to.user.username });
const send = (from: { auth: Record<string, string> }, id: string, body: string) =>
  request(app).post(`/api/v1/messages/conversations/${id}/messages`).set(from.auth).send({ body });

describe('who can message whom', () => {
  it('refuses strangers, and one-way follows', async () => {
    const a = await makeUser(old);
    const b = await makeUser(old);
    const cold = await open(a, b);
    expect(cold.status).toBe(403);
    expect(cold.body.code).toBe('NOT_CONNECTED');

    await follow(a, b); // only one way
    expect((await open(a, b)).status).toBe(403);
    expect((await open(b, a)).status).toBe(403);
  });

  it('allows mutual followers, and always returns the same conversation for a pair', async () => {
    const { a, b } = await friends();
    const first = await open(a, b);
    expect(first.status).toBe(200);
    const again = await open(b, a);
    expect(again.body.id).toBe(first.body.id);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('never lets you message yourself or a missing member', async () => {
    const a = await makeUser(old);
    expect((await open(a, a)).status).toBe(400);
    expect((await request(app).post('/api/v1/messages/conversations').set(a.auth).send({ username: 'nobody_here' })).status).toBe(404);
  });

  it('stops the moment someone blocks or unfollows', async () => {
    const { a, b } = await friends();
    const { body: c } = await open(a, b);
    expect((await send(a, c.id, 'hello')).status).toBe(201);

    await request(app).delete(`/api/v1/users/${a.user.username}/follow`).set(b.auth); // b unfollows a
    const blocked = await send(a, c.id, 'still there?');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('NOT_CONNECTED');
    // History stays readable but the thread says it can't continue.
    expect((await request(app).get(`/api/v1/messages/conversations/${c.id}`).set(a.auth)).body.can_message).toBe(false);
  });

  it('is closed to blocked members even if they still follow each other', async () => {
    const { a, b } = await friends();
    await prisma.block.create({ data: { blocker_id: a.user.id, blocked_id: b.user.id } });
    expect((await open(b, a)).status).toBe(403);
  });
});

describe('sending and reading', () => {
  it('delivers, shows unread to the other side, and marks read when opened', async () => {
    const { a, b } = await friends();
    const { body: c } = await open(a, b);
    await send(a, c.id, 'hey, nice lab!');
    await send(a, c.id, 'want to team up?');

    const inbox = await request(app).get('/api/v1/messages/conversations').set(b.auth);
    expect(inbox.body.conversations[0]).toMatchObject({ unread: 2, with: { username: a.user.username } });
    expect(inbox.body.conversations[0].last_message).toMatchObject({ body: 'want to team up?', from_me: false });
    expect((await request(app).get('/api/v1/messages/unread-count').set(b.auth)).body.unread).toBe(2);

    const thread = await request(app).get(`/api/v1/messages/conversations/${c.id}`).set(b.auth);
    expect(thread.body.messages.map((m: { body: string }) => m.body)).toEqual(['hey, nice lab!', 'want to team up?']);
    expect(thread.body.messages[0].from_me).toBe(false);
    expect((await request(app).get('/api/v1/messages/unread-count').set(b.auth)).body.unread).toBe(0);
    expect((await request(app).get('/api/v1/messages/unread-count').set(a.auth)).body.unread).toBe(0);
  });

  it('polls for only what is new', async () => {
    const { a, b } = await friends();
    const { body: c } = await open(a, b);
    const first = await send(a, c.id, 'one');
    await new Promise((r) => setTimeout(r, 15));
    await send(a, c.id, 'two');
    const fresh = await request(app).get(`/api/v1/messages/conversations/${c.id}`).query({ after: first.body.created_at }).set(b.auth);
    expect(fresh.body.messages.map((m: { body: string }) => m.body)).toEqual(['two']);
  });

  it('keeps conversations private to the two people in them', async () => {
    const { a, b } = await friends();
    const stranger = await makeUser(old);
    const { body: c } = await open(a, b);
    await send(a, c.id, 'secret');
    expect((await request(app).get(`/api/v1/messages/conversations/${c.id}`).set(stranger.auth)).status).toBe(404);
    expect((await send(stranger, c.id, 'let me in')).status).toBe(404);
    expect((await request(app).get('/api/v1/messages/conversations').set(stranger.auth)).body.conversations).toEqual([]);
  });

  it('sends one notification per burst, with a link to the thread', async () => {
    const { a, b } = await friends();
    const { body: c } = await open(a, b);
    await send(a, c.id, 'one');
    await send(a, c.id, 'two');
    await send(a, c.id, 'three');
    const notes = await prisma.notification.findMany({ where: { user_id: b.user.id, type: 'message' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.link).toBe(`/messages/${c.id}`);
  });

  it('lets a sender unsend, and hides it from both sides', async () => {
    const { a, b } = await friends();
    const { body: c } = await open(a, b);
    const m = await send(a, c.id, 'oops wrong chat');
    expect((await request(app).delete(`/api/v1/messages/messages/${m.body.id}`).set(b.auth)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/messages/messages/${m.body.id}`).set(a.auth)).status).toBe(200);
    expect((await request(app).get(`/api/v1/messages/conversations/${c.id}`).set(b.auth)).body.messages).toEqual([]);
  });
});

describe('safety in messages', () => {
  it('filters phone numbers, off-platform requests, and abuse', async () => {
    const { a, b } = await friends();
    const { body: c } = await open(a, b);
    expect((await send(a, c.id, 'call me 0803 555 1234')).body.code).toBe('PERSONAL_INFO');
    expect((await send(a, c.id, 'add me on snap')).body.code).toBe('OFF_PLATFORM');
    expect((await send(a, c.id, 'you are a bitch')).body.code).toBe('ABUSIVE_LANGUAGE');
    expect(await prisma.message.count()).toBe(0);
  });

  it('blocks links from brand-new accounts', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await follow(a, b);
    await follow(b, a);
    const { body: c } = await open(a, b);
    expect((await send(a, c.id, 'see https://example.com')).body.code).toBe('LINKS_NOT_ALLOWED');
  });

  it('lets a struggling friend be heard: delivers the message, shows support, and tells a moderator', async () => {
    const { a, b } = await friends();
    const { body: c } = await open(a, b);
    const res = await send(a, c.id, 'i feel like i want to die');
    expect(res.status).toBe(201);
    expect(res.body.support).toMatch(/988/);
    expect(await prisma.message.count()).toBe(1);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'filter.self_harm' } })).actor_id).toBe(a.user.id);
  });

  it('is closed to suspended members', async () => {
    const { a, b } = await friends();
    const { body: c } = await open(a, b);
    await prisma.user.update({ where: { id: a.user.id }, data: { suspended_until: new Date(Date.now() + 86400000) } });
    expect((await send(a, c.id, 'hi')).body.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('reporting a message', () => {
  it('lets only someone in the chat report it, and shows moderators the message in context', async () => {
    const { a, b } = await friends();
    const stranger = await makeUser(old);
    const mod = await makeUser({ role: 'moderator' });
    const { body: c } = await open(a, b);
    await send(b, c.id, 'earlier message');
    const bad = await send(a, c.id, 'something unkind');

    expect((await request(app).post('/api/v1/reports').set(stranger.auth).send({ target_type: 'message', target_id: bad.body.id, reason: 'bullying' })).status).toBe(404);
    expect((await request(app).post('/api/v1/reports').set(a.auth).send({ target_type: 'message', target_id: bad.body.id, reason: 'bullying' })).body.code).toBe('SELF_REPORT');
    expect((await request(app).post('/api/v1/reports').set(b.auth).send({ target_type: 'message', target_id: bad.body.id, reason: 'bullying' })).status).toBe(201);

    const queue = await request(app).get('/api/v1/admin/reports').set(mod.auth);
    const item = queue.body.items[0];
    expect(item.target).toMatchObject({ exists: true, author: a.user.username, excerpt: 'something unkind' });
    expect(item.target.context.map((x: { body: string }) => x.body)).toEqual(['earlier message', 'something unkind']);
    expect(item.target.context.find((x: { reported: boolean }) => x.reported).body).toBe('something unkind');

    // Removing it hides it from the conversation for both people.
    await request(app).post(`/api/v1/admin/reports/${item.id}/resolve`).set(mod.auth).send({ action: 'remove' });
    const thread = await request(app).get(`/api/v1/messages/conversations/${c.id}`).set(b.auth);
    expect(thread.body.messages.map((m: { body: string }) => m.body)).toEqual(['earlier message']);
  });

  it('gives moderators no way to browse conversations that were not reported', async () => {
    const mod = await makeUser({ role: 'moderator' });
    const { a, b } = await friends();
    const { body: c } = await open(a, b);
    await send(a, c.id, 'private');
    expect((await request(app).get(`/api/v1/messages/conversations/${c.id}`).set(mod.auth)).status).toBe(404);
    expect((await request(app).get('/api/v1/messages/conversations').set(mod.auth)).body.conversations).toEqual([]);
  });
});
