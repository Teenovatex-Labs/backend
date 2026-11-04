import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const makeWindow = () =>
  prisma.applicationWindow.create({
    data: { opens_at: new Date('2026-12-01'), closes_at: new Date('2026-12-20'), decisions_publish_at: new Date('2027-01-05'), form_version: 'v1' },
  });

const applicant = (window_id: string, over: Record<string, unknown> = {}) => ({
  reference: 'TX-2026-00001',
  window_id,
  email: 'a@example.com',
  full_name: 'Ada',
  birth_date: new Date('2010-05-01'),
  country: 'NG',
  city: 'Lagos',
  whatsapp: '+2340000000',
  education_level: 'secondary',
  interests: ['ai'],
  current_skills: [],
  learning_goals: [],
  ...over,
});

describe('admissions schema', () => {
  it('starts applications as drafts and windows as scheduled', async () => {
    const w = await makeWindow();
    const a = await prisma.application.create({ data: applicant(w.id) });
    expect(w.status).toBe('scheduled');
    expect(a.status).toBe('draft');
  });

  it('allows one application per email per window, and unique references', async () => {
    const w = await makeWindow();
    await prisma.application.create({ data: applicant(w.id) });
    await expect(prisma.application.create({ data: applicant(w.id, { reference: 'TX-2026-00002' }) })).rejects.toThrow();
    await expect(prisma.application.create({ data: applicant(w.id, { email: 'b@example.com' }) })).rejects.toThrow();
  });

  it('keeps invitation tokens unique', async () => {
    const data = { token_hash: 'h1', email: 'a@example.com', source: 'admin' as const, expires_at: new Date('2027-01-01') };
    await prisma.invitation.create({ data });
    await expect(prisma.invitation.create({ data: { ...data, email: 'b@example.com' } })).rejects.toThrow();
  });

  it('makes new users active but not grandfathered', async () => {
    const { user } = await makeUser();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.membership_status).toBe('active');
    expect(row.existing_member).toBe(false);
  });
});
