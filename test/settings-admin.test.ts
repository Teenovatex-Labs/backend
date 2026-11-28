import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { getSetting, invalidateSettingCache } from '../src/lib/settings.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(async () => {
  invalidateSettingCache();
  await resetDb();
});
afterAll(() => prisma.$disconnect());

describe('admin system settings', () => {
  it('returns typed defaults and denies moderators', async () => {
    const admin = await makeUser({ role: 'admin' });
    const moderator = await makeUser({ role: 'moderator' });
    const response = await request(app).get('/api/v1/admin/settings').set(admin.auth);

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'announcement_default_expiry_days', value: 30, updated_by: null, updated_at: null }),
      expect.objectContaining({ key: 'partner_min_cohort_size', value: 10 }),
      expect.objectContaining({ key: 'maintenance_banner', value: '' }),
      expect.objectContaining({ key: 'inactive_review_days', value: 14 }),
    ]));
    expect((await request(app).get('/api/v1/admin/settings').set(moderator.auth)).status).toBe(403);
  });

  it('updates settings, records old/new values, and invalidates the cache', async () => {
    const admin = await makeUser({ role: 'admin' });
    expect(await getSetting('announcement_default_expiry_days')).toBe(30);

    const response = await request(app)
      .patch('/api/v1/admin/settings')
      .set(admin.auth)
      .send({ key: 'announcement_default_expiry_days', value: 7 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ key: 'announcement_default_expiry_days', value: 7, updated_by: admin.user.id });
    expect(await getSetting('announcement_default_expiry_days')).toBe(7);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'settings.update' } });
    expect(audit.meta).toMatchObject({ key: 'announcement_default_expiry_days', old_value: 30, new_value: 7 });
  });

  it('rejects unknown keys and unsafe or invalid values', async () => {
    const admin = await makeUser({ role: 'admin' });
    for (const body of [
      { key: 'unknown_setting', value: true },
      { key: 'announcement_default_expiry_days', value: 0 },
      { key: 'partner_min_cohort_size', value: 9 },
      { key: 'whatsapp_invite_url', value: 'https://example.com/invite' },
      { key: 'whatsapp_invite_url', value: 'http://chat.whatsapp.com/InviteCode' },
      { key: 'maintenance_banner', value: 'x'.repeat(501) },
    ]) {
      const response = await request(app).patch('/api/v1/admin/settings').set(admin.auth).send(body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }
  });
});
