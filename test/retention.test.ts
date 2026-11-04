import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { newInvitation } from '../src/lib/admissions.js';
import { runRetention } from '../src/jobs/retention.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

let n = 0;
const make = async (status: 'declined' | 'accepted', age: number, over: Record<string, unknown> = {}) => {
  n++;
  const w = (await prisma.applicationWindow.findFirst()) ?? (await prisma.applicationWindow.create({ data: { opens_at: new Date(Date.now() - 9e8), closes_at: new Date(Date.now() - 5e8), decisions_publish_at: new Date(Date.now() - 1e8), form_version: 'v1' } }));
  const year = new Date().getUTCFullYear() - age;
  return prisma.application.create({
    data: {
      reference: `TX-2026-${String(n).padStart(5, '0')}`, window_id: w.id, status, published_at: new Date(), email: `a${n}@example.com`, full_name: 'Applicant',
      birth_date: new Date(`${year}-01-15T00:00:00.000Z`), country: 'NG', city: 'Abuja', whatsapp: '+2348012345678', education_level: 'secondary',
      interests: ['web'], current_skills: [], learning_goals: [], ...over,
    },
  });
};
const invite = (application_id: string, email: string, over: Record<string, unknown> = {}) => {
  const i = newInvitation();
  return prisma.invitation.create({ data: { token_hash: i.hash, email, role: 'member', source: 'application', application_id, expires_at: i.expires, ...over } });
};

describe('retention', () => {
  it('deletes declined applications only after their retention date', async () => {
    const later = await make('declined', 18, { retention_delete_at: new Date(Date.now() + 86400000) });
    const due = await make('declined', 18, { retention_delete_at: new Date(Date.now() - 1000) });
    await prisma.applicationAnswer.create({ data: { application_id: due.id, position: 1, question_key: 'q', question_text: 'Q', source: 'fixed', format: 'text', answer: 'private' } });
    const res = await runRetention();
    expect(res.declined).toBe(1);
    expect(await prisma.application.findUnique({ where: { id: due.id } })).toBeNull();
    expect(await prisma.applicationAnswer.count()).toBe(0);
    expect(await prisma.application.findUnique({ where: { id: later.id } })).not.toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'application.purge' } });
    expect(JSON.stringify(log.meta)).not.toContain('private');
  });

  it('deletes an under-age acceptance whose guardian never confirmed once the invitation has expired', async () => {
    const stale = await make('accepted', 14);
    await invite(stale.id, stale.email, { expires_at: new Date(Date.now() - 1000) });
    await prisma.guardianConsent.create({ data: { application_id: stale.id, parent_email: 'p@example.com', token_hash: 'h1', text_version: 'v1', expires_at: new Date(Date.now() - 1000) } });
    const res = await runRetention();
    expect(res.consent).toBe(1);
    expect(res.expired_consents).toBe(1);
    expect(await prisma.application.count()).toBe(0);
    expect(await prisma.invitation.count()).toBe(0);
  });

  it('keeps anyone who can still finish: usable invitation, confirmed guardian, adult, or an account already made', async () => {
    const waiting = await make('accepted', 14);
    await invite(waiting.id, waiting.email);
    const confirmed = await make('accepted', 14);
    await invite(confirmed.id, confirmed.email, { expires_at: new Date(Date.now() - 1000) });
    await prisma.guardianConsent.create({ data: { application_id: confirmed.id, parent_email: 'p@example.com', token_hash: 'h2', text_version: 'v1', status: 'confirmed', expires_at: new Date(Date.now() - 1000) } });
    const adult = await make('accepted', 19);
    await invite(adult.id, adult.email, { expires_at: new Date(Date.now() - 1000) });
    const joined = await make('accepted', 14);
    await invite(joined.id, joined.email, { expires_at: new Date(Date.now() - 1000), used_at: new Date() });
    const res = await runRetention();
    expect(res.consent).toBe(0);
    expect(await prisma.application.count()).toBe(4);
  });
});
