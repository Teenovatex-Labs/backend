import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { hashToken } from '../src/lib/tokens.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

const sent = vi.hoisted(() => ({ offers: [] as string[], accept: [] as string[] }));
vi.mock('../src/lib/admissionsEmail.js', () => ({
  sendApplicationLink: async () => {}, sendApplicationReceived: async () => {}, sendApplicationReminderOpen: async () => {},
  sendClarificationRequest: async () => {},
  sendAcceptance: async (_e: string, t: string) => { sent.accept.push(t); },
  sendDecline: async () => {}, sendWaitlisted: async () => {},
  sendWaitlistOffer: async (_e: string, t: string) => { sent.offers.push(t); },
}));

beforeEach(async () => { await resetDb(); sent.offers.length = 0; sent.accept.length = 0; });
afterAll(() => prisma.$disconnect());

const DAY = 86_400_000;
const setup = async (over: Record<string, unknown> = {}) => {
  const window = await prisma.applicationWindow.create({ data: { opens_at: new Date(Date.now() - 20 * DAY), closes_at: new Date(Date.now() - 10 * DAY), decisions_publish_at: new Date(Date.now() - DAY), form_version: 'v1', status: 'published' } });
  const a = await prisma.application.create({
    data: {
      reference: 'TX-2026-00001', window_id: window.id, status: 'waitlisted', submitted_at: new Date(), published_at: new Date(), email: 'kid@example.com', email_verified_at: new Date(),
      full_name: 'Ada Obi', birth_date: new Date('2010-01-01'), country: 'NG', city: 'Lagos', whatsapp: '+2340000000', education_level: 'secondary',
      interests: [], current_skills: [], learning_goals: [], resume_token_hash: hashToken('x'.repeat(64)), resume_expires_at: new Date(Date.now() + DAY), ...over,
    },
  });
  const admin = await makeUser({ role: 'admin' });
  return { a, admin };
};
const offer = (id: string, who: { auth: Record<string, string> }) => request(app).post(`/api/v1/admin/applications/${id}/waitlist-offer`).set(who.auth);
const respond = (token: string, accept: boolean) => request(app).post(`/api/v1/applications/offer/${token}/respond`).send({ accept });

describe('waitlist offers', () => {
  it('offers a place with 72 hours, once at a time, and only to released waitlist decisions', async () => {
    const { a, admin } = await setup();
    const r = await offer(a.id, admin);
    expect(r.status).toBe(201);
    const hours = (new Date(r.body.expires_at).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThanOrEqual(72);
    expect((await offer(a.id, admin)).body.code).toBe('OFFER_OPEN');
  });

  it('refuses to offer a place to someone who is not waitlisted or not yet released', async () => {
    const { a, admin } = await setup({ published_at: null });
    expect((await offer(a.id, admin)).body.code).toBe('NOT_WAITLISTED');
  });

  it('accepting turns it into an acceptance with one invitation, even on a double click', async () => {
    const { a, admin } = await setup();
    await offer(a.id, admin);
    const token = sent.offers[0]!;
    expect((await request(app).get(`/api/v1/applications/offer/${token}`)).body).toMatchObject({ state: 'pending', first_name: 'Ada' });
    const [one, two] = await Promise.all([respond(token, true), respond(token, true)]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('accepted');
    expect(await prisma.invitation.count({ where: { application_id: a.id } })).toBe(1);
    expect(sent.accept).toHaveLength(1);
  });

  it('declining closes the application and starts the retention clock', async () => {
    const { a, admin } = await setup();
    await offer(a.id, admin);
    expect((await respond(sent.offers[0]!, false)).body.accepted).toBe(false);
    const row = await prisma.application.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.status).toBe('declined');
    expect(row.retention_delete_at).not.toBeNull();
    expect(await prisma.invitation.count({ where: { application_id: a.id } })).toBe(0);
  });

  it('refuses an answer after 72 hours and lets the admin offer again', async () => {
    const { a, admin } = await setup();
    await offer(a.id, admin);
    await prisma.application.update({ where: { id: a.id }, data: { waitlist_offer_expires_at: new Date(Date.now() - 1000) } });
    const token = sent.offers[0]!;
    expect((await respond(token, true)).status).toBe(410);
    expect((await request(app).get(`/api/v1/applications/offer/${token}`)).body.state).toBe('expired');
    const list = await request(app).get('/api/v1/admin/applications?status=waitlisted').set(admin.auth);
    expect(list.body.items[0].waitlist_offer.state).toBe('expired');
    expect((await offer(a.id, admin)).status).toBe(201);
  });

  it('rejects a made-up link', async () => {
    expect((await request(app).get(`/api/v1/applications/offer/${'f'.repeat(64)}`)).status).toBe(404);
  });
});
