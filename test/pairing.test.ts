import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const yearsAgo = (n: number) => new Date(Date.now() - n * 365.25 * 86_400_000 - 5 * 86_400_000);
const dayFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const A = '/api/v1/admin';
const M = '/api/v1/messages';
type U = Awaited<ReturnType<typeof makeUser>>;
const teen = (over: object = {}) => makeUser({ birth_date: yearsAgo(14), ...over });
const adult = (over: object = {}) => makeUser({ birth_date: yearsAgo(30), ...over });
const pair = (admin: U, ids: string[], over: Record<string, unknown> = {}) =>
  request(app).post(`${A}/pairings`).set(admin.auth).send({ member_ids: ids, goal: 'Build a small weather app together', ends_on: dayFromNow(30), ...over });

describe('suggestions', () => {
  it('ranks by shared and complementary topics inside the same age band', async () => {
    const admin = await makeUser({ role: 'admin' });
    const me = await teen({ interests: ['robots', 'python'], skills: ['design'] });
    const best = await teen({ interests: ['design'], skills: ['python', 'robots'] });
    const some = await teen({ interests: ['robots'] });
    await teen({ interests: ['cooking'] }); // no overlap
    await adult({ interests: ['robots', 'python'], skills: ['python'] }); // other band
    const res = await request(app).get(`${A}/pairing/suggestions?member_id=${me.user.id}`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([best.user.id, some.user.id]);
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com|birth|full_name/);
  });
  it('is admin-only', async () => {
    const mod = await makeUser({ role: 'moderator' });
    expect((await request(app).get(`${A}/pairing/suggestions?member_id=x`).set(mod.auth)).status).toBe(403);
  });
});

describe('same-band pairings', () => {
  it('go live immediately, open a thread for the pair, and are audited', async () => {
    const admin = await makeUser({ role: 'admin' });
    const [a, b] = [await teen(), await teen()];
    const res = await pair(admin, [a.user.id, b.user.id]);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    expect(res.body.supervised).toBe(false);
    const mine = await request(app).get('/api/v1/pairings/mine').set(a.auth);
    expect(mine.body.items[0].conversation_id).toBeTruthy();
    expect(JSON.stringify(mine.body)).not.toContain('rationale');
    expect(await prisma.auditLog.count({ where: { action: 'pairing.create' } })).toBe(1);
    expect(await prisma.notification.count({ where: { type: 'pairing' } })).toBe(2);
  });
  it('refuses double booking, blocked members, unknown ages and inactive members', async () => {
    const admin = await makeUser({ role: 'admin' });
    const [a, b, c] = [await teen(), await teen(), await teen()];
    await pair(admin, [a.user.id, b.user.id]);
    expect((await pair(admin, [a.user.id, c.user.id])).body.code).toBe('ALREADY_PAIRED');
    const [d, e] = [await teen(), await teen()];
    await prisma.block.create({ data: { blocker_id: d.user.id, blocked_id: e.user.id } });
    expect((await pair(admin, [d.user.id, e.user.id])).body.code).toBe('BLOCKED');
    const noAge = await teen({ birth_date: null });
    expect((await pair(admin, [c.user.id, noAge.user.id])).body.code).toBe('AGE_UNKNOWN');
    const gone = await teen({ membership_status: 'inactive' });
    expect((await pair(admin, [c.user.id, gone.user.id])).body.code).toBe('MEMBER_NOT_ACTIVE');
    expect((await pair(admin, [c.user.id, c.user.id])).status).toBe(400);
  });
});

describe('minor and adult pairings', () => {
  const setup = async () => {
    const admin = await makeUser({ role: 'admin' });
    const second = await makeUser({ role: 'admin' });
    const supervisor = await makeUser({ role: 'moderator' });
    const kid = await teen();
    const grownup = await adult();
    return { admin, second, supervisor, kid, grownup };
  };
  const rationale = 'Mentor volunteers in the same robotics club and the teen asked for help.';

  it('needs rationale, supervisor and a cleared adult before it can be proposed', async () => {
    const { admin, supervisor, kid, grownup } = await setup();
    const ids = [kid.user.id, grownup.user.id];
    expect((await pair(admin, ids)).body.code).toBe('SUPERVISOR_REQUIRED');
    expect((await pair(admin, ids, { supervisor_id: supervisor.user.id })).body.code).toBe('RATIONALE_REQUIRED');
    expect((await pair(admin, ids, { supervisor_id: supervisor.user.id, rationale })).body.code).toBe('ADULT_NOT_CLEARED');
    const clear = await request(app).post(`${A}/members/${grownup.user.id}/safeguarding-clearance`).set(admin.auth).send({ cleared: true });
    expect(clear.status).toBe(200);
    expect((await pair(admin, ids, { supervisor_id: kid.user.id, rationale })).body.code).toBe('SUPERVISOR_IS_MEMBER');
    expect((await pair(admin, ids, { supervisor_id: admin.user.id, rationale })).status).toBe(201);
  });

  it('stays proposed until a different admin approves, and the creator cannot', async () => {
    const { admin, second, supervisor, kid, grownup } = await setup();
    await request(app).post(`${A}/members/${grownup.user.id}/safeguarding-clearance`).set(admin.auth).send({ cleared: true });
    const res = await pair(admin, [kid.user.id, grownup.user.id], { supervisor_id: supervisor.user.id, rationale });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('proposed');
    expect(res.body.supervised).toBe(true);
    expect((await request(app).get('/api/v1/pairings/mine').set(kid.auth)).body.items).toHaveLength(0);
    expect((await request(app).post(`${A}/pairings/${res.body.id}/approve`).set(admin.auth)).body.code).toBe('SECOND_ADMIN_REQUIRED');

    // Clearance withdrawn in between: the approval re-checks and refuses.
    await request(app).post(`${A}/members/${grownup.user.id}/safeguarding-clearance`).set(second.auth).send({ cleared: false });
    expect((await request(app).post(`${A}/pairings/${res.body.id}/approve`).set(second.auth)).body.code).toBe('ADULT_NOT_CLEARED');
    await request(app).post(`${A}/members/${grownup.user.id}/safeguarding-clearance`).set(second.auth).send({ cleared: true });

    const ok = await request(app).post(`${A}/pairings/${res.body.id}/approve`).set(second.auth);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('active');
    expect(ok.body.second_approved_by).toBe(second.user.id);
    expect(await prisma.auditLog.count({ where: { action: 'pairing.approve' } })).toBe(1);
  });

  it('only adults can be cleared, and nobody clears themselves', async () => {
    const { admin, kid } = await setup();
    expect((await request(app).post(`${A}/members/${kid.user.id}/safeguarding-clearance`).set(admin.auth).send({ cleared: true })).body.code).toBe('NOT_AN_ADULT');
    const selfAdmin = await makeUser({ role: 'admin', birth_date: yearsAgo(40) });
    expect((await request(app).post(`${A}/members/${selfAdmin.user.id}/safeguarding-clearance`).set(selfAdmin.auth).send({ cleared: true })).body.code).toBe('SELF_CLEARANCE');
  });
});

describe('the pairing thread', () => {
  const live = async () => {
    const admin = await makeUser({ role: 'admin' });
    const supervisor = await makeUser({ role: 'moderator' });
    const kid = await teen();
    const grownup = await adult({ safeguarding_cleared_at: new Date() });
    const second = await makeUser({ role: 'admin' });
    const created = await pair(admin, [kid.user.id, grownup.user.id], { supervisor_id: supervisor.user.id, rationale: 'Mentor from the robotics club; the teen asked for help.' });
    await request(app).post(`${A}/pairings/${created.body.id}/approve`).set(second.auth);
    const convo = await prisma.conversation.findFirstOrThrow({ where: { pairing_id: created.body.id } });
    const outsider = await teen();
    return { admin, supervisor, kid, grownup, convo, outsider, id: created.body.id as string };
  };
  const send = (u: U, convoId: string, body = 'Hi, ready to start?') => request(app).post(`${M}/conversations/${convoId}/messages`).set(u.auth).send({ body });

  it('lets the pair talk, lets the supervisor read but not post, and keeps outsiders out', async () => {
    const { kid, grownup, supervisor, convo, outsider } = await live();
    expect((await send(kid, convo.id)).status).toBe(201);
    expect((await send(grownup, convo.id, 'Yes, lets begin')).status).toBe(201);
    const read = await request(app).get(`${M}/conversations/${convo.id}`).set(supervisor.auth);
    expect(read.status).toBe(200);
    expect(read.body.messages).toHaveLength(2);
    expect(read.body.read_only).toBe(true);
    expect((await send(supervisor, convo.id)).body.code).toBe('SUPERVISOR_READ_ONLY');
    expect(await prisma.auditLog.count({ where: { action: 'pairing.supervisor_view' } })).toBe(1);
    expect((await request(app).get(`${M}/conversations/${convo.id}`).set(outsider.auth)).status).toBe(404);
    expect((await send(outsider, convo.id)).status).toBe(404);
  });

  it('keeps the content filter on and refuses images', async () => {
    const { kid, convo } = await live();
    const phone = await send(kid, convo.id, 'call me on 08012345678 or email me at kid@example.com');
    expect(phone.status).toBe(422);
    const img = await request(app).post(`${M}/conversations/${convo.id}/images`).set(kid.auth).attach('image', Buffer.from('x'), 'a.png');
    expect(img.status).toBe(403);
  });

  it('turns read-only after the end date', async () => {
    const { kid, convo, id } = await live();
    await prisma.pairing.update({ where: { id }, data: { ends_on: new Date(Date.now() - 2 * 86_400_000) } });
    expect((await send(kid, convo.id)).body.code).toBe('PAIRING_ENDED');
    const view = await request(app).get(`${M}/conversations/${convo.id}`).set(kid.auth);
    expect(view.body.read_only).toBe(true);
  });

  it('is cancelled for good when one member blocks another', async () => {
    const { kid, grownup, convo, id } = await live();
    await prisma.block.create({ data: { blocker_id: grownup.user.id, blocked_id: kid.user.id } });
    expect((await send(kid, convo.id)).body.code).toBe('PAIRING_ENDED');
    expect((await prisma.pairing.findUniqueOrThrow({ where: { id } })).status).toBe('closed');
  });

  it('can be reported, which puts the message in front of moderators', async () => {
    const { kid, grownup, convo } = await live();
    const m = await send(grownup, convo.id, 'You should keep this between us');
    const rep = await request(app).post('/api/v1/reports').set(kid.auth).send({ target_type: 'message', target_id: m.body.id, reason: 'unsafe_contact' });
    expect(rep.status).toBe(201);
    expect(await prisma.report.count({ where: { target_type: 'message', status: 'open' } })).toBe(1);
  });
});
