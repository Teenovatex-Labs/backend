import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { runRetention } from '../src/jobs/retention.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

const cloud = vi.hoisted(() => ({ uploaded: [] as Buffer[], deleted: [] as string[], tokens: [] as string[] }));
vi.mock('../src/middleware/upload.js', async (orig) => ({
  ...(await orig<typeof import('../src/middleware/upload.js')>()),
  uploadPrivateImage: vi.fn(async (buf: Buffer) => { cloud.uploaded.push(buf); return { public_id: `applications/t-${cloud.uploaded.length}` }; }),
  signedImageUrl: vi.fn((id: string) => `https://signed.example.com/${id}`),
  deletePrivateImage: vi.fn(async (id: string) => { cloud.deleted.push(id); }),
}));
vi.mock('../src/lib/admissionsEmail.js', () => ({
  sendApplicationLink: async (_e: string, t: string) => { cloud.tokens.push(t); },
  sendApplicationReceived: async () => {},
  sendApplicationReminderOpen: async () => {},
}));

beforeEach(async () => { await resetDb(); cloud.uploaded.length = 0; cloud.deleted.length = 0; cloud.tokens.length = 0; });
afterAll(() => prisma.$disconnect());

const DAY = 86_400_000;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const begin = async () => {
  await prisma.applicationWindow.create({ data: { opens_at: new Date(Date.now() - DAY), closes_at: new Date(Date.now() + 5 * DAY), decisions_publish_at: new Date(Date.now() + 10 * DAY), form_version: 'v1' } });
  await request(app).post('/api/v1/applications/start').send({
    email: 'ada@example.com', full_name: 'Ada Obi', birth_date: '2010-05-01', country: 'Nigeria', city: 'Lagos', whatsapp: '+234 800 000 0000', education_level: 'secondary',
  });
  return cloud.tokens[cloud.tokens.length - 1]!;
};
const png = () => sharp({ create: { width: 40, height: 40, channels: 3, background: '#f5e89e' } }).png().toBuffer();

describe('application attachments', () => {
  it('stores images privately, caps them, and removes them from storage on delete', async () => {
    const token = await begin();
    for (let i = 0; i < 3; i++) {
      const r = await request(app).post('/api/v1/applications/attachments/image').set(bearer(token)).attach('image', await png(), 'work.png');
      expect(r.status).toBe(201);
      expect(r.body.url).toBeNull();
    }
    const fourth = await request(app).post('/api/v1/applications/attachments/image').set(bearer(token)).attach('image', await png(), 'work.png');
    expect(fourth.body.code).toBe('ATTACHMENT_LIMIT');
    const list = await request(app).get('/api/v1/applications/attachments').set(bearer(token));
    const rm = await request(app).delete(`/api/v1/applications/attachments/${list.body.items[0].id}`).set(bearer(token));
    expect(rm.status).toBe(200);
    expect(cloud.deleted).toHaveLength(1);
  });

  it('rejects non-images and non-https links, and accepts https links', async () => {
    const token = await begin();
    const bad = await request(app).post('/api/v1/applications/attachments/image').set(bearer(token)).attach('image', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' });
    expect(bad.status).toBe(400);
    expect((await request(app).post('/api/v1/applications/attachments/link').set(bearer(token)).send({ url: 'http://example.com' })).status).toBe(400);
    expect((await request(app).post('/api/v1/applications/attachments/link').set(bearer(token)).send({ url: 'https://github.com/ada/project' })).status).toBe(201);
  });

  it('locks once review starts, and only reviewers get a signed link (audited)', async () => {
    const token = await begin();
    const up = await request(app).post('/api/v1/applications/attachments/image').set(bearer(token)).attach('image', await png(), 'work.png');
    const admin = await makeUser({ role: 'admin' });
    const member = await makeUser();
    const appRow = await prisma.application.findFirstOrThrow();
    const link = await request(app).get(`/api/v1/admin/applications/${appRow.id}/attachments/${up.body.id}/link`).set(admin.auth);
    expect(link.body.url).toContain('signed.example.com');
    expect((await request(app).get(`/api/v1/admin/applications/${appRow.id}/attachments/${up.body.id}/link`).set(member.auth)).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: 'application.attachment_view' } })).toBe(1);
    await prisma.application.update({ where: { id: appRow.id }, data: { status: 'under_review', locked_at: new Date() } });
    const locked = await request(app).post('/api/v1/applications/attachments/link').set(bearer(token)).send({ url: 'https://example.com/a' });
    expect(locked.body.code).toBe('APPLICATION_LOCKED');
  });

  it('deletes stored images when retention purges a declined application', async () => {
    const token = await begin();
    await request(app).post('/api/v1/applications/attachments/image').set(bearer(token)).attach('image', await png(), 'work.png');
    await prisma.application.updateMany({ data: { status: 'declined', retention_delete_at: new Date(Date.now() - DAY) } });
    expect((await runRetention()).declined).toBe(1);
    expect(cloud.deleted).toEqual(['applications/t-1']);
    expect(await prisma.applicationAttachment.count()).toBe(0);
  });
});
