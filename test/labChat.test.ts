import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const old = { created_at: new Date(Date.now() - 30 * 86400000) };
const team = async () => {
  const owner = await makeUser(old);
  const mate = await makeUser(old);
  const lab = await makeProject(owner.user.id, { name: 'Study Buddy' });
  await prisma.labMember.createMany({ data: [{ lab_id: lab.id, user_id: owner.user.id, role: 'owner' }, { lab_id: lab.id, user_id: mate.user.id }] });
  return { owner, mate, lab };
};
const open = (auth: Record<string, string>, lab: string) => request(app).post(`/api/v1/projects/${lab}/chat`).set(auth);
const send = (auth: Record<string, string>, id: string, body: string) => request(app).post(`/api/v1/messages/conversations/${id}/messages`).set(auth).send({ body });
const thread = (auth: Record<string, string>, id: string) => request(app).get(`/api/v1/messages/conversations/${id}`).set(auth);

describe('lab team chat', () => {
  it('opens once for the whole team, by id or slug, and only for team members', async () => {
    const { owner, mate, lab } = await team();
    const outsider = await makeUser(old);
    expect((await open(outsider.auth, lab.id)).status).toBe(403);
    const a = await open(owner.auth, lab.id);
    const b = await open(mate.auth, lab.slug);
    expect(a.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(a.body.with).toMatchObject({ username: 'Study Buddy', group: true, lab_slug: lab.slug });
    expect(await prisma.conversation.count()).toBe(1);
    expect(await prisma.conversationMember.count()).toBe(2);
  });

  it('delivers messages to everyone on the team with who said them', async () => {
    const { owner, mate, lab } = await team();
    const { body: c } = await open(owner.auth, lab.id);
    const sent = await send(owner.auth, c.id, 'standup at 5?');
    expect(sent.body.from_name).toBe(owner.user.username);

    const seen = await thread(mate.auth, c.id);
    expect(seen.body.messages).toEqual([expect.objectContaining({ body: 'standup at 5?', from_me: false, from_name: owner.user.username })]);
    expect(seen.body.with.group).toBe(true);
    expect(seen.body.can_message).toBe(true);
    const inbox = await request(app).get('/api/v1/messages/conversations').set(mate.auth);
    expect(inbox.body.conversations[0]).toMatchObject({ unread: 0, with: { username: 'Study Buddy', group: true, member_count: 2 } });
    expect(await prisma.notification.count({ where: { user_id: mate.user.id, type: 'message' } })).toBe(1);
  });

  it('follows the team: new members join the chat and see it, people who leave lose it', async () => {
    const { owner, lab } = await team();
    const { body: c } = await open(owner.auth, lab.id);
    await send(owner.auth, c.id, 'welcome everyone');

    const newbie = await makeUser(old);
    await request(app).post(`/api/v1/projects/${lab.id}/join`).set(newbie.auth).send({ message: 'hi' });
    const { body: team1 } = await request(app).get(`/api/v1/projects/${lab.id}/team`).set(owner.auth);
    await request(app).post(`/api/v1/projects/${lab.id}/requests/${team1.requests[0].id}/accept`).set(owner.auth);
    expect((await thread(newbie.auth, c.id)).status).toBe(200);

    await request(app).delete(`/api/v1/projects/${lab.id}/members/${newbie.user.username}`).set(owner.auth);
    expect((await thread(newbie.auth, c.id)).status).toBe(404);
    expect((await send(newbie.auth, c.id, 'still here?')).status).toBe(404);
  });

  it('hides blocked members’ messages inside the team chat, for the blocker only', async () => {
    const { owner, mate, lab } = await team();
    const { body: c } = await open(owner.auth, lab.id);
    await send(mate.auth, c.id, 'something rude');
    await send(owner.auth, c.id, 'something fine');
    await prisma.block.create({ data: { blocker_id: owner.user.id, blocked_id: mate.user.id } });

    const ownerView = await thread(owner.auth, c.id);
    expect(ownerView.body.messages.map((m: { body: string }) => m.body)).toEqual(['something fine']);
    const mateView = await thread(mate.auth, c.id);
    expect(mateView.body.messages.map((m: { body: string }) => m.body)).toEqual(['something rude']);
    expect((await request(app).get('/api/v1/messages/unread-count').set(owner.auth)).body.unread).toBe(0);
  });

  it('applies the same safety rules as private chat', async () => {
    const { owner, lab } = await team();
    const { body: c } = await open(owner.auth, lab.id);
    expect((await send(owner.auth, c.id, 'call me 0803 555 1234')).body.code).toBe('PERSONAL_INFO');
    expect((await send(owner.auth, c.id, 'add me on snap')).body.code).toBe('OFF_PLATFORM');
    await prisma.user.update({ where: { id: owner.user.id }, data: { suspended_until: new Date(Date.now() + 86400000) } });
    expect((await send(owner.auth, c.id, 'hello')).body.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('lets a team member report a message, and the moderator sees who wrote it', async () => {
    const { owner, mate, lab } = await team();
    const mod = await makeUser({ role: 'moderator' });
    const { body: c } = await open(owner.auth, lab.id);
    const bad = await send(mate.auth, c.id, 'something unkind');
    expect((await request(app).post('/api/v1/reports').set(owner.auth).send({ target_type: 'message', target_id: bad.body.id, reason: 'bullying' })).status).toBe(201);
    const queue = await request(app).get('/api/v1/admin/reports').set(mod.auth);
    expect(queue.body.items[0].target).toMatchObject({ author: mate.user.username, excerpt: 'something unkind' });
  });
});
