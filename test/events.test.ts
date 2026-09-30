import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

const hours = (n: number) => new Date(Date.now() + n * 60 * 60 * 1000).toISOString();
const newEvent = (over: Record<string, unknown> = {}) => ({
  title: 'Lab Night',
  description: 'Show what you built this week.',
  starts_at: hours(48),
  ...over,
});

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('events', () => {
  it('lets only staff create events', async () => {
    const member = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    expect((await request(app).post('/api/v1/events').set(member.auth).send(newEvent())).status).toBe(403);
    expect((await request(app).post('/api/v1/events').send(newEvent())).status).toBe(401);
    expect((await request(app).post('/api/v1/events').set(admin.auth).send(newEvent())).status).toBe(201);
    expect((await request(app).post('/api/v1/events').set(admin.auth).send(newEvent({ title: 'x' }))).status).toBe(400);
  });

  it('lists upcoming soonest-first and past separately', async () => {
    const admin = await makeUser({ role: 'moderator' });
    await request(app).post('/api/v1/events').set(admin.auth).send(newEvent({ title: 'Later', starts_at: hours(96) }));
    await request(app).post('/api/v1/events').set(admin.auth).send(newEvent({ title: 'Sooner', starts_at: hours(24) }));
    await request(app).post('/api/v1/events').set(admin.auth).send(newEvent({ title: 'Ancient', starts_at: hours(-200) }));

    const up = await request(app).get('/api/v1/events');
    expect(up.body.events.map((e: { title: string }) => e.title)).toEqual(['Sooner', 'Later']);
    const past = await request(app).get('/api/v1/events?when=past');
    expect(past.body.events.map((e: { title: string }) => e.title)).toEqual(['Ancient']);
  });

  it('RSVPs once, counts it, notifies, and can be cancelled', async () => {
    const admin = await makeUser({ role: 'admin' });
    const member = await makeUser();
    const { body: event } = await request(app).post('/api/v1/events').set(admin.auth).send(newEvent());

    const first = await request(app).post(`/api/v1/events/${event.id}/rsvp`).set(member.auth);
    expect(first.status).toBe(200);
    expect(first.body.rsvp_count).toBe(1);
    await request(app).post(`/api/v1/events/${event.id}/rsvp`).set(member.auth); // again: no double count
    expect(await prisma.eventRsvp.count()).toBe(1);
    expect(await prisma.notification.count({ where: { user_id: member.user.id, type: 'event' } })).toBe(1);

    const seen = await request(app).get(`/api/v1/events/${event.id}`).set(member.auth);
    expect(seen.body).toMatchObject({ has_rsvped: true, rsvp_count: 1, is_full: false });
    expect((await request(app).get(`/api/v1/events/${event.id}`)).body.has_rsvped).toBe(false);

    const cancel = await request(app).delete(`/api/v1/events/${event.id}/rsvp`).set(member.auth);
    expect(cancel.body.rsvp_count).toBe(0);
  });

  it('stops at capacity even when requests arrive together', async () => {
    const admin = await makeUser({ role: 'admin' });
    const { body: event } = await request(app).post('/api/v1/events').set(admin.auth).send(newEvent({ capacity: 2 }));
    const members = await Promise.all([1, 2, 3, 4, 5].map(() => makeUser()));
    const results = await Promise.all(members.map((m) => request(app).post(`/api/v1/events/${event.id}/rsvp`).set(m.auth)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.filter((r) => r.body.code === 'EVENT_FULL')).toHaveLength(3);
    expect(await prisma.eventRsvp.count()).toBe(2);
  });

  it('refuses RSVPs to an event that is over, and to members without a confirmed age', async () => {
    const admin = await makeUser({ role: 'admin' });
    const member = await makeUser();
    const { body: old } = await request(app).post('/api/v1/events').set(admin.auth).send(newEvent({ starts_at: hours(-50) }));
    expect((await request(app).post(`/api/v1/events/${old.id}/rsvp`).set(member.auth)).body.code).toBe('EVENT_OVER');

    const { body: fresh } = await request(app).post('/api/v1/events').set(admin.auth).send(newEvent());
    const noAge = await makeUser({ birth_date: null });
    expect((await request(app).post(`/api/v1/events/${fresh.id}/rsvp`).set(noAge.auth)).body.code).toBe('AGE_REQUIRED');
  });

  it('lets staff edit and delete', async () => {
    const admin = await makeUser({ role: 'admin' });
    const { body: event } = await request(app).post('/api/v1/events').set(admin.auth).send(newEvent());
    const edited = await request(app).patch(`/api/v1/events/${event.id}`).set(admin.auth).send({ title: 'Lab Night 2' });
    expect(edited.body.title).toBe('Lab Night 2');
    expect((await request(app).delete(`/api/v1/events/${event.id}`).set(admin.auth)).status).toBe(200);
    expect((await request(app).get(`/api/v1/events/${event.id}`)).status).toBe(404);
  });
});
