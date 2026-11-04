import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/admissionsEmail.js', async (orig) => ({
  ...(await orig<typeof import('../src/lib/admissionsEmail.js')>()),
  sendGuardianRequest: vi.fn(async () => undefined),
}));

import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { newInvitation, newResumeToken } from '../src/lib/admissions.js';
import { sendGuardianRequest } from '../src/lib/admissionsEmail.js';
import { resetDb } from './helpers.js';

beforeEach(async () => {
  vi.mocked(sendGuardianRequest).mockClear();
  await resetDb();
  config.requireInvitation = true;
});
afterAll(async () => {
  config.requireInvitation = false;
  await prisma.$disconnect();
});

const year = (n: number) => `${new Date().getUTCFullYear() - n}-01-15`;

const accepted = async (age: number) => {
  const w = await prisma.applicationWindow.create({ data: { opens_at: new Date(Date.now() - 9e8), closes_at: new Date(Date.now() - 5e8), decisions_publish_at: new Date(Date.now() - 1e8), form_version: 'v1' } });
  const link = newResumeToken();
  const inv = newInvitation();
  const a = await prisma.application.create({
    data: {
      reference: 'TX-2026-00001', window_id: w.id, status: 'accepted', published_at: new Date(), email: 'kid@example.com', full_name: 'Kid Learner',
      birth_date: new Date(`${year(age)}T00:00:00.000Z`), country: 'NG', city: 'Abuja', whatsapp: '+2348012345678', education_level: 'secondary',
      interests: ['web'], current_skills: [], learning_goals: [], resume_token_hash: link.hash, resume_expires_at: link.expires,
    },
  });
  await prisma.invitation.create({ data: { token_hash: inv.hash, email: a.email, role: 'member', source: 'application', application_id: a.id, expires_at: inv.expires } });
  return { a, auth: { Authorization: `Bearer ${link.token}` }, invite: inv.token };
};

const signup = (token: string) => ({ full_name: 'Kid Learner', username: 'kid_l', email: 'kid@example.com', password: 'Sup3rSecret', birth_date: '2010-01-15', invite_token: token });

const tokenFromMock = () => vi.mocked(sendGuardianRequest).mock.calls[0]![2];

describe('guardian confirmation after acceptance', () => {
  it('blocks a 14-year-old from creating an account until the guardian confirms', async () => {
    const { auth, invite } = await accepted(14);
    expect((await request(app).get('/api/v1/applications/me').set(auth)).body.guardian).toEqual({ required: true, status: 'not_requested' });
    expect((await request(app).post('/api/v1/auth/register').send(signup(invite))).body.code).toBe('CONSENT_REQUIRED');

    const asked = await request(app).post('/api/v1/applications/guardian').set(auth).send({ parent_email: 'Parent@Example.com' });
    expect(asked.status).toBe(202);
    const t = tokenFromMock();
    expect((await request(app).get(`/api/v1/applications/guardian/${t}`)).body).toMatchObject({ child_first_name: 'Kid', status: 'pending' });
    expect((await request(app).post('/api/v1/auth/register').send(signup(invite))).body.code).toBe('CONSENT_REQUIRED');

    expect((await request(app).post(`/api/v1/applications/guardian/${t}/confirm`)).body.status).toBe('confirmed');
    expect((await request(app).post('/api/v1/auth/register').send(signup(invite))).status).toBe(201);
  });

  it('does not ask an older applicant, and refuses their own email as the guardian', async () => {
    const adult = await accepted(18);
    expect((await request(app).get('/api/v1/applications/me').set(adult.auth)).body.guardian.required).toBe(false);
    expect((await request(app).post('/api/v1/applications/guardian').set(adult.auth).send({ parent_email: 'p@example.com' })).body.code).toBe('NOT_NEEDED');
    expect((await request(app).post('/api/v1/auth/register').send(signup(adult.invite))).status).toBe(201);
  });

  it('refuses the applicant’s own address and a guessed token', async () => {
    const { auth } = await accepted(14);
    expect((await request(app).post('/api/v1/applications/guardian').set(auth).send({ parent_email: 'kid@example.com' })).body.code).toBe('SAME_EMAIL');
    expect((await request(app).get(`/api/v1/applications/guardian/${'a'.repeat(64)}`)).status).toBe(404);
  });

  it('will not confirm after the deadline', async () => {
    const { auth, a } = await accepted(14);
    await request(app).post('/api/v1/applications/guardian').set(auth).send({ parent_email: 'p@example.com' });
    await prisma.guardianConsent.update({ where: { application_id: a.id }, data: { expires_at: new Date(Date.now() - 1000) } });
    const res = await request(app).post(`/api/v1/applications/guardian/${tokenFromMock()}/confirm`);
    expect(res.status).toBe(409);
    expect((await request(app).get(`/api/v1/applications/guardian/${tokenFromMock()}`)).body.status).toBe('expired');
  });

  it('lets the guardian withdraw: the invitation dies and an existing account is paused', async () => {
    const { auth, invite, a } = await accepted(14);
    await request(app).post('/api/v1/applications/guardian').set(auth).send({ parent_email: 'p@example.com' });
    const t = tokenFromMock();
    await request(app).post(`/api/v1/applications/guardian/${t}/confirm`);
    await request(app).post('/api/v1/auth/register').send(signup(invite));
    const res = await request(app).post(`/api/v1/applications/guardian/${t}/withdraw`);
    expect(res.body.status).toBe('withdrawn');
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'kid@example.com' } })).membership_status).toBe('inactive');
    expect(await prisma.auditLog.count({ where: { action: 'guardian.withdraw', target_id: a.id } })).toBe(1);
  });
});
