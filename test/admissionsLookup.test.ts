import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/admissionsEmail.js', async (orig) => ({
  ...(await orig<typeof import('../src/lib/admissionsEmail.js')>()),
  sendApplicationLink: vi.fn(async () => undefined),
  sendLookupMember: vi.fn(async () => undefined),
  sendLookupNone: vi.fn(async () => undefined),
}));

import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { sendApplicationLink, sendLookupMember, sendLookupNone } from '../src/lib/admissionsEmail.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});
afterAll(() => prisma.$disconnect());

const lookup = (email: string) => request(app).post('/api/v1/applications/lookup').send({ email });

describe('status lookup', () => {
  it('gives the same answer for a member, an applicant and a stranger, and tells the inbox the truth', async () => {
    const { user } = await makeUser();
    const w = await prisma.applicationWindow.create({ data: { opens_at: new Date(Date.now() - 9e8), closes_at: new Date(Date.now() - 5e8), decisions_publish_at: new Date(Date.now() + 1e8), form_version: 'v1' } });
    await prisma.application.create({
      data: { reference: 'TX-2026-00001', window_id: w.id, status: 'submitted', email: 'applicant@example.com', full_name: 'A', birth_date: new Date('2008-01-01'), country: 'NG', city: 'Abuja', whatsapp: '+2348012345678', education_level: 'secondary', interests: ['web'], current_skills: [], learning_goals: [] },
    });
    const a = await lookup(user.email);
    const b = await lookup('applicant@example.com');
    const c = await lookup('nobody@example.com');
    expect([a.status, b.status, c.status]).toEqual([202, 202, 202]);
    expect(a.body).toEqual(b.body);
    expect(b.body).toEqual(c.body);
    expect(sendLookupMember).toHaveBeenCalledWith(user.email);
    expect(sendApplicationLink).toHaveBeenCalledTimes(1);
    expect(sendLookupNone).toHaveBeenCalledWith('nobody@example.com');
  });

  it('issues a working link to the applicant', async () => {
    const w = await prisma.applicationWindow.create({ data: { opens_at: new Date(Date.now() - 9e8), closes_at: new Date(Date.now() - 5e8), decisions_publish_at: new Date(Date.now() + 1e8), form_version: 'v1' } });
    await prisma.application.create({
      data: { reference: 'TX-2026-00002', window_id: w.id, status: 'submitted', email: 'applicant@example.com', full_name: 'A', birth_date: new Date('2008-01-01'), country: 'NG', city: 'Abuja', whatsapp: '+2348012345678', education_level: 'secondary', interests: ['web'], current_skills: [], learning_goals: [] },
    });
    await lookup('applicant@example.com');
    const token = vi.mocked(sendApplicationLink).mock.calls[0]![1];
    const me = await request(app).get('/api/v1/applications/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.status).toBe('submitted');
  });
});
