import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { UNDO_WINDOW_MS } from '../src/controllers/pet.js';
import { dayToDb, localDay } from '../src/lib/day.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const log = (auth: Record<string, string>, body: object) => request(app).post('/api/v1/pet/actions').set(auth).send(body);
const undo = (auth: Record<string, string>, id: string) => request(app).post(`/api/v1/pet/actions/${id}/undo`).set(auth);

describe('What Alfred did', () => {
  it('lists the member’s own actions, newest first, with whether they can still be undone', async () => {
    const me = await makeUser();
    const other = await makeUser();
    await log(me.auth, { kind: 'vote', summary: 'Voted for Sam', payload: { lab_id: 'lab_1' } });
    await log(other.auth, { kind: 'vote', summary: 'Voted for X', payload: { lab_id: 'lab_2' } });
    await log(me.auth, { kind: 'readall', summary: 'Marked 2 notifications read', payload: { ids: ['a', 'b'] } });
    const res = await request(app).get('/api/v1/pet/actions').set(me.auth);
    expect(res.body.actions.map((a: { summary: string }) => a.summary)).toEqual(['Marked 2 notifications read', 'Voted for Sam']);
    expect(res.body.actions.every((a: { can_undo: boolean }) => a.can_undo)).toBe(true);
    expect(res.body.undo_window_minutes).toBe(15);
  });

  it('only accepts reversible kinds with well-formed payloads', async () => {
    const me = await makeUser();
    expect((await log(me.auth, { kind: 'delete_account', summary: 'x', payload: {} })).status).toBe(400);
    expect((await log(me.auth, { kind: 'follow', summary: 'x', payload: { username: 'sam_builds' } })).status).toBe(400); // follows no longer exist
    expect((await log(me.auth, { kind: 'vote', summary: 'x', payload: {} })).status).toBe(400);
    expect((await log(me.auth, { kind: 'readall', summary: 'x', payload: { ids: Array(101).fill('a') } })).status).toBe(400);
    expect((await request(app).post('/api/v1/pet/actions').send({})).status).toBe(401);
  });

  it('undoes a vote, and takes the owner’s points back', async () => {
    const owner = await makeUser();
    const me = await makeUser();
    const lab = await makeProject(owner.user.id);
    await request(app).post(`/api/v1/projects/${lab.id}/vote`).set(me.auth);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } })).points).toBe(10);
    const { body } = await log(me.auth, { kind: 'vote', summary: 'Voted', payload: { lab_id: lab.id } });
    expect((await undo(me.auth, body.id)).status).toBe(200);
    expect(await prisma.vote.count()).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } })).points).toBe(0);
  });

  it('undoes marking everything read, but only the member’s own notifications', async () => {
    const me = await makeUser();
    const other = await makeUser();
    const mine = await prisma.notification.create({ data: { user_id: me.user.id, type: 'system', message: 'hi', read: true } });
    const theirs = await prisma.notification.create({ data: { user_id: other.user.id, type: 'system', message: 'secret', read: true } });
    const { body } = await log(me.auth, { kind: 'readall', summary: 'Marked read', payload: { ids: [mine.id, theirs.id] } });
    await undo(me.auth, body.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: mine.id } })).read).toBe(false);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).read).toBe(true); // not theirs to touch
  });

  it('cannot be undone after the window, or by someone else', async () => {
    const me = await makeUser();
    const other = await makeUser();
    const { body } = await log(me.auth, { kind: 'readall', summary: 'Marked read', payload: { ids: [] } });
    expect((await undo(other.auth, body.id)).status).toBe(404);
    await prisma.petAction.update({ where: { id: body.id }, data: { created_at: new Date(Date.now() - UNDO_WINDOW_MS - 1000) } });
    const late = await undo(me.auth, body.id);
    expect(late.status).toBe(410);
    expect(late.body.code).toBe('TOO_LATE');
    expect((await request(app).get('/api/v1/pet/actions').set(me.auth)).body.actions[0].can_undo).toBe(false);
  });

  it('cannot be double-run by simultaneous undos', async () => {
    const owner = await makeUser();
    const me = await makeUser();
    const lab = await makeProject(owner.user.id);
    await prisma.vote.create({ data: { user_id: me.user.id, project_id: lab.id, vote_day: dayToDb(localDay(null)) } });
    await prisma.project.update({ where: { id: lab.id }, data: { vote_count: 1 } });
    const { body } = await log(me.auth, { kind: 'vote', summary: 'Voted', payload: { lab_id: lab.id } });
    const results = await Promise.all([1, 2, 3].map(() => undo(me.auth, body.id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: lab.id } })).vote_count).toBe(0);
  });
});
