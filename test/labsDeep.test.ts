import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { runReminders } from '../src/jobs/reminders.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const old = { created_at: new Date(Date.now() - 30 * 86400000) };
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, auth?: Record<string, string>, body?: object) => {
  const r = request(app)[method](`/api/v1/projects${path}`);
  if (auth) r.set(auth);
  return body ? r.send(body) : r;
};

/** A lab with an owner (on the team, as creating one through the API would make them). */
const setup = async () => {
  const owner = await makeUser(old);
  const lab = await makeProject(owner.user.id);
  await prisma.labMember.create({ data: { lab_id: lab.id, user_id: owner.user.id, role: 'owner' } });
  const outsider = await makeUser(old);
  return { owner, lab, outsider };
};

describe('build log', () => {
  it('lets the team post updates, shows them publicly, and lets only the author or owner delete', async () => {
    const { owner, lab, outsider } = await setup();
    expect((await api('post', `/${lab.id}/updates`, outsider.auth, { title: 'Sneaky', body: 'not my lab' })).body.code).toBe('NOT_ON_TEAM');
    const posted = await api('post', `/${lab.id}/updates`, owner.auth, { title: 'Week one', body: 'We got login working' });
    expect(posted.status).toBe(201);

    const seen = await api('get', `/${lab.slug}/updates`); // by slug, signed out
    expect(seen.body.updates[0]).toMatchObject({ title: 'Week one', author: { username: owner.user.username } });
    expect((await api('delete', `/${lab.id}/updates/${posted.body.id}`, outsider.auth)).status).toBe(403);
    expect((await api('delete', `/${lab.id}/updates/${posted.body.id}`, owner.auth)).status).toBe(200);
  });

  it('runs updates through the content filter', async () => {
    const { owner, lab } = await setup();
    expect((await api('post', `/${lab.id}/updates`, owner.auth, { title: 'Call me', body: 'my number is 0803 555 1234' })).body.code).toBe('PERSONAL_INFO');
  });
});

describe('planning board', () => {
  it('is private to the team', async () => {
    const { owner, lab, outsider } = await setup();
    await api('post', `/${lab.id}/tasks`, owner.auth, { title: 'Design the logo' });
    expect((await api('get', `/${lab.id}/board`, outsider.auth)).status).toBe(403);
    expect((await api('get', `/${lab.id}/board`)).status).toBe(401);
    const board = await api('get', `/${lab.id}/board`, owner.auth);
    expect(board.body.columns.backlog.map((t: { title: string }) => t.title)).toEqual(['Design the logo']);
  });

  it('moves cards between columns, keeps order tidy, and stamps completion', async () => {
    const { owner, lab } = await setup();
    const ids: string[] = [];
    for (const title of ['A', 'B', 'C']) ids.push((await api('post', `/${lab.id}/tasks`, owner.auth, { title: `Task ${title}` })).body.id);

    // Drop C at the top of the same column.
    await api('patch', `/${lab.id}/tasks/${ids[2]}`, owner.auth, { status: 'backlog', position: 0 });
    let board = await api('get', `/${lab.id}/board`, owner.auth);
    expect(board.body.columns.backlog.map((t: { title: string }) => t.title)).toEqual(['Task C', 'Task A', 'Task B']);
    expect(board.body.columns.backlog.map((t: { position: number }) => t.position)).toEqual([0, 1, 2]);

    await api('patch', `/${lab.id}/tasks/${ids[0]}`, owner.auth, { status: 'in_progress' });
    const done = await api('patch', `/${lab.id}/tasks/${ids[1]}`, owner.auth, { status: 'done' });
    expect(done.body.done_at).not.toBeNull();
    board = await api('get', `/${lab.id}/board`, owner.auth);
    expect(board.body.columns.in_progress).toHaveLength(1);
    expect(board.body.columns.done).toHaveLength(1);
    expect(board.body.columns.backlog.map((t: { position: number }) => t.position)).toEqual([0]); // re-packed

    const back = await api('patch', `/${lab.id}/tasks/${ids[1]}`, owner.auth, { status: 'testing' });
    expect(back.body.done_at).toBeNull();
  });

  it('assigns only to teammates, and tells the assignee', async () => {
    const { owner, lab, outsider } = await setup();
    const mate = await makeUser(old);
    await prisma.labMember.create({ data: { lab_id: lab.id, user_id: mate.user.id } });
    expect((await api('post', `/${lab.id}/tasks`, owner.auth, { title: 'Xtask', assignee: outsider.user.username })).body.code).toBe('INVALID_ASSIGNEE');
    const t = await api('post', `/${lab.id}/tasks`, owner.auth, { title: 'Write the README', assignee: mate.user.username });
    expect(t.status).toBe(201);
    const patched = await api('patch', `/${lab.id}/tasks/${t.body.id}`, owner.auth, { assignee: null });
    expect(patched.body.assignee).toBeNull();
    await api('patch', `/${lab.id}/tasks/${t.body.id}`, owner.auth, { assignee: mate.user.username });
    expect(await prisma.notification.count({ where: { user_id: mate.user.id, type: 'task' } })).toBe(1);
  });

  it('lists what is open for me across my labs, soonest first', async () => {
    const { owner, lab } = await setup();
    await api('post', `/${lab.id}/tasks`, owner.auth, { title: 'Later', due_at: hours(72) });
    await api('post', `/${lab.id}/tasks`, owner.auth, { title: 'Sooner', due_at: hours(5) });
    await api('post', `/${lab.id}/tasks`, owner.auth, { title: 'Finished', status: 'done' });
    const res = await api('get', '/mine/tasks', owner.auth);
    expect(res.body.tasks.map((t: { title: string }) => t.title)).toEqual(['Sooner', 'Later']);
  });
});

describe('milestones', () => {
  it('are public to read, team-only to change, and celebrated when reached', async () => {
    const { owner, lab, outsider } = await setup();
    const mate = await makeUser(old);
    await prisma.labMember.create({ data: { lab_id: lab.id, user_id: mate.user.id } });
    const m = await api('post', `/${lab.id}/milestones`, owner.auth, { title: 'Public beta', due_at: hours(200) });
    expect(m.status).toBe(201);
    expect((await api('post', `/${lab.id}/milestones`, outsider.auth, { title: 'Nope' })).status).toBe(403);
    expect((await api('get', `/${lab.id}/milestones`)).body.milestones).toHaveLength(1);

    const done = await api('patch', `/${lab.id}/milestones/${m.body.id}`, owner.auth, { done: true });
    expect(done.body.done).toBe(true);
    const note = await prisma.notification.findFirstOrThrow({ where: { user_id: mate.user.id, type: 'milestone' } });
    expect(note.message).toMatch(/Public beta/);
  });
});

describe('teams', () => {
  it('runs the join-request flow: ask, be told, and become a member', async () => {
    const { owner, lab, outsider } = await setup();
    const ask = await api('post', `/${lab.id}/join`, outsider.auth, { message: 'I can do the art!' });
    expect(ask.status).toBe(201);
    expect((await api('post', `/${lab.id}/join`, outsider.auth, {})).body.code).toBe('ALREADY_REQUESTED');
    expect(await prisma.notification.count({ where: { user_id: owner.user.id, type: 'join_request' } })).toBe(1);

    const team = await api('get', `/${lab.id}/team`, owner.auth);
    expect(team.body.requests).toHaveLength(1);
    expect(team.body.requests[0].message).toBe('I can do the art!');
    expect((await api('get', `/${lab.id}/team`, outsider.auth)).body.requests).toEqual([]); // only the owner sees requests

    expect((await api('post', `/${lab.id}/requests/${team.body.requests[0].id}/accept`, outsider.auth)).status).toBe(403);
    expect((await api('post', `/${lab.id}/requests/${team.body.requests[0].id}/accept`, owner.auth)).status).toBe(200);
    expect((await api('get', `/${lab.id}/team`, outsider.auth)).body.my_role).toBe('member');
    expect((await api('get', `/${lab.id}/board`, outsider.auth)).status).toBe(200);
  });

  it('does not let a declined member keep asking, and stops owners joining their own lab', async () => {
    const { owner, lab, outsider } = await setup();
    await api('post', `/${lab.id}/join`, outsider.auth, {});
    const { body } = await api('get', `/${lab.id}/team`, owner.auth);
    await api('post', `/${lab.id}/requests/${body.requests[0].id}/decline`, owner.auth);
    expect((await api('post', `/${lab.id}/join`, outsider.auth, {})).body.code).toBe('DECLINED');
    expect((await api('post', `/${lab.id}/join`, owner.auth, {})).body.code).toBe('ALREADY_MEMBER');
  });

  it('lets a member leave, lets the owner remove them, and never lets the owner leave', async () => {
    const { owner, lab } = await setup();
    const a = await makeUser(old);
    const b = await makeUser(old);
    for (const u of [a, b]) await prisma.labMember.create({ data: { lab_id: lab.id, user_id: u.user.id } });
    const task = await api('post', `/${lab.id}/tasks`, owner.auth, { title: 'Mine', assignee: a.user.username });

    expect((await api('delete', `/${lab.id}/members/${b.user.username}`, a.auth)).status).toBe(403); // a can't remove b
    expect((await api('delete', `/${lab.id}/members/${a.user.username}`, a.auth)).status).toBe(200); // a leaves
    expect((await prisma.labTask.findUniqueOrThrow({ where: { id: task.body.id } })).assignee_id).toBeNull();
    expect((await api('delete', `/${lab.id}/members/${b.user.username}`, owner.auth)).status).toBe(200);
    expect((await api('delete', `/${lab.id}/members/${owner.user.username}`, owner.auth)).body.code).toBe('OWNER');
  });

  it('makes the creator the owner when a lab is created through the API', async () => {
    const me = await makeUser(old);
    const created = await request(app).post('/api/v1/projects').set(me.auth).field('name', 'Fresh lab').field('short_description', 'x').field('description', 'A fresh description').field('category', 'web');
    expect(created.status).toBe(201);
    const team = await api('get', `/${created.body.id}/team`, me.auth);
    expect(team.body.members).toEqual([expect.objectContaining({ username: me.user.username, role: 'owner' })]);
  });

  it('lets teammates message each other without following', async () => {
    const { owner, lab } = await setup();
    const mate = await makeUser(old);
    await prisma.labMember.create({ data: { lab_id: lab.id, user_id: mate.user.id } });
    const open = await request(app).post('/api/v1/messages/conversations').set(owner.auth).send({ username: mate.user.username });
    expect(open.status).toBe(200);
    const stranger = await makeUser(old);
    expect((await request(app).post('/api/v1/messages/conversations').set(owner.auth).send({ username: stranger.user.username })).status).toBe(403);
  });
});

describe('reminders', () => {
  it('announces tasks, milestones and events that are about to happen, once each', async () => {
    const { owner, lab } = await setup();
    const mate = await makeUser(old);
    await prisma.labMember.create({ data: { lab_id: lab.id, user_id: mate.user.id } });
    await api('post', `/${lab.id}/tasks`, owner.auth, { title: 'Ship it', due_at: hours(10), assignee: mate.user.username });
    await api('post', `/${lab.id}/tasks`, owner.auth, { title: 'Far away', due_at: hours(100) });
    await api('post', `/${lab.id}/tasks`, owner.auth, { title: 'Already done', due_at: hours(3), status: 'done' });
    await api('post', `/${lab.id}/milestones`, owner.auth, { title: 'Demo day', due_at: hours(20) });
    const fan = await makeUser(old);
    const event = await prisma.event.create({ data: { title: 'Lab Night', description: 'Come along', starts_at: new Date(Date.now() + 30 * 60_000) } });
    await prisma.eventRsvp.create({ data: { event_id: event.id, user_id: fan.user.id } });

    const first = await runReminders();
    expect(first).toEqual({ tasks: 1, milestones: 1, events: 1 });
    expect(await prisma.notification.count({ where: { user_id: mate.user.id, type: 'deadline', message: { contains: 'Ship it' } } })).toBe(1);
    expect(await prisma.notification.count({ where: { user_id: owner.user.id, type: 'deadline', message: { contains: 'Demo day' } } })).toBe(1);
    expect(await prisma.notification.count({ where: { user_id: fan.user.id, type: 'event', message: { contains: 'Starting soon' } } })).toBe(1);

    expect(await runReminders()).toEqual({ tasks: 0, milestones: 0, events: 0 }); // nothing twice
  });

  it('is safe when two scans run at the same moment', async () => {
    const { owner, lab } = await setup();
    await api('post', `/${lab.id}/tasks`, owner.auth, { title: 'Ship it', due_at: hours(10) });
    const runs = await Promise.all([runReminders(), runReminders(), runReminders()]);
    expect(runs.reduce((n, r) => n + r.tasks, 0)).toBe(1);
    expect(await prisma.notification.count({ where: { type: 'deadline' } })).toBe(1);
  });

  it('reminds again if the deadline is moved', async () => {
    const { owner, lab } = await setup();
    const t = await api('post', `/${lab.id}/tasks`, owner.auth, { title: 'Ship it', due_at: hours(10) });
    await runReminders();
    await api('patch', `/${lab.id}/tasks/${t.body.id}`, owner.auth, { due_at: hours(12) });
    expect((await runReminders()).tasks).toBe(1);
  });
});
