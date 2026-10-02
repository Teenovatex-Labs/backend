import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cloud = vi.hoisted(() => ({ uploaded: [] as Buffer[], deleted: [] as string[] }));
vi.mock('../src/middleware/upload.js', async (orig) => ({
  ...(await orig<typeof import('../src/middleware/upload.js')>()),
  uploadPrivateImage: vi.fn(async (buf: Buffer) => {
    cloud.uploaded.push(buf);
    return { public_id: `chat-images/test-${cloud.uploaded.length}` };
  }),
  signedImageUrl: vi.fn((id: string) => `https://signed.example.com/${id}`),
  deletePrivateImage: vi.fn(async (id: string) => {
    cloud.deleted.push(id);
  }),
}));

import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { ATTACHMENTS_PER_DAY, cleanImage } from '../src/lib/attachments.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(async () => {
  await resetDb();
  cloud.uploaded.length = 0;
  cloud.deleted.length = 0;
});
afterAll(() => prisma.$disconnect());

const old = { created_at: new Date(Date.now() - 30 * 86400000) };
const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#f4a5c0' } }).png().toBuffer();

async function setup() {
  const owner = await makeUser(old);
  const mate = await makeUser(old);
  const mod = await makeUser({ ...old, role: 'moderator' });
  const lab = await makeProject(owner.user.id, { name: 'Study Buddy' });
  await prisma.labMember.createMany({ data: [{ lab_id: lab.id, user_id: owner.user.id, role: 'owner' }, { lab_id: lab.id, user_id: mate.user.id }] });
  const chat = await request(app).post(`/api/v1/projects/${lab.id}/chat`).set(owner.auth);
  return { owner, mate, mod, lab, chat: chat.body.id as string };
}
const sendImage = async (auth: Record<string, string>, chat: string, opts: { file?: Buffer; type?: string; caption?: string } = {}) =>
  request(app)
    .post(`/api/v1/messages/conversations/${chat}/images`)
    .set(auth)
    .field('body', opts.caption ?? '')
    .attach('image', opts.file ?? (await png()), { filename: 'pic.png', contentType: opts.type ?? 'image/png' });
const link = (auth: Record<string, string>, id: string) => request(app).get(`/api/v1/messages/images/${id}`).set(auth);
const review = (auth: Record<string, string>, id: string, body: object) => request(app).post(`/api/v1/admin/attachments/${id}/review`).set(auth).send(body);

describe('cleaning an image', () => {
  it('re-encodes it, so camera and location data are gone, and rejects things that are not images', async () => {
    const withExif = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'red' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret place' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeTruthy();
    const out = await cleanImage(withExif);
    expect((await sharp(out.data).metadata()).exif).toBeUndefined();
    await expect(cleanImage(Buffer.from('not an image at all'))).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });
});

describe('sending an image', () => {
  it('works in a team chat, and waits for review', async () => {
    const { owner, chat } = await setup();
    const res = await sendImage(owner.auth, chat, { caption: 'our wireframe' });
    expect(res.status).toBe(201);
    expect(res.body.image.status).toBe('pending');
    expect(cloud.uploaded).toHaveLength(1);
    expect((await prisma.messageAttachment.findFirstOrThrow()).status).toBe('pending');
  });

  it('is refused in private chats, for new accounts, suspended members, open reports, bad files and over the daily limit', async () => {
    const { owner, mate, chat } = await setup();
    // private chat
    const dm = await request(app).post('/api/v1/messages/conversations').set(owner.auth).send({ username: mate.user.username });
    expect((await sendImage(owner.auth, dm.body.id)).body.code).toBe('TEAM_CHAT_ONLY');
    // a file that is not an image, even if it claims to be
    expect((await sendImage(owner.auth, chat, { file: Buffer.from('hello'), type: 'image/png' })).body.code).toBe('INVALID_IMAGE');
    // wrong type
    expect((await sendImage(owner.auth, chat, { type: 'image/gif' })).body.code).toBe('INVALID_FILE_TYPE');
    // open report against the sender
    const reporter = await makeUser(old);
    await prisma.report.create({ data: { reporter_id: reporter.user.id, target_type: 'user', target_id: owner.user.id, target_user_id: owner.user.id, reason: 'spam' } });
    expect((await sendImage(owner.auth, chat)).body.code).toBe('UNDER_REVIEW');
    await prisma.report.deleteMany();
    // suspended
    await prisma.user.update({ where: { id: owner.user.id }, data: { suspended_until: new Date(Date.now() + 86400000) } });
    expect((await sendImage(owner.auth, chat)).status).toBe(403);
    await prisma.user.update({ where: { id: owner.user.id }, data: { suspended_until: null } });
    // new account
    await prisma.user.update({ where: { id: owner.user.id }, data: { created_at: new Date() } });
    expect((await sendImage(owner.auth, chat)).body.code).toBe('ACCOUNT_TOO_NEW');
    await prisma.user.update({ where: { id: owner.user.id }, data: { created_at: old.created_at } });
    // daily limit
    for (let i = 0; i < ATTACHMENTS_PER_DAY; i++) expect((await sendImage(owner.auth, chat)).status).toBe(201);
    expect((await sendImage(owner.auth, chat)).body.code).toBe('IMAGE_LIMIT');
  });
});

describe('who can see an image', () => {
  it('only the sender and moderators until it is approved, then the team, never outsiders', async () => {
    const { owner, mate, mod, chat } = await setup();
    const outsider = await makeUser(old);
    const sent = await sendImage(owner.auth, chat);
    const id = sent.body.image.id as string;

    expect((await link(owner.auth, id)).status).toBe(200);
    expect((await link(mod.auth, id)).status).toBe(200);
    expect((await link(mate.auth, id)).body.code).toBe('NOT_APPROVED');
    expect((await link(outsider.auth, id)).status).toBe(404);

    const queue = await request(app).get('/api/v1/admin/attachments').set(mod.auth);
    expect(queue.body.attachments).toEqual([expect.objectContaining({ id, url: expect.stringContaining('https://signed.example.com/'), sender: expect.objectContaining({ username: owner.user.username }) })]);
    expect((await request(app).get('/api/v1/admin/attachments').set(mate.auth)).status).toBe(403);

    expect((await review(mod.auth, id, { action: 'approve' })).status).toBe(200);
    expect((await link(mate.auth, id)).body.url).toContain('signed.example.com');
    expect((await link(outsider.auth, id)).status).toBe(404);
    const seen = await request(app).get(`/api/v1/messages/conversations/${chat}`).set(mate.auth);
    expect(seen.body.messages[0].image).toMatchObject({ id, status: 'approved' });
  });

  it('goes back to moderators when someone reports the message', async () => {
    const { owner, mate, mod, chat } = await setup();
    const id = (await sendImage(owner.auth, chat)).body.image.id as string;
    await review(mod.auth, id, { action: 'approve' });
    const messageId = (await prisma.messageAttachment.findUniqueOrThrow({ where: { id } })).message_id;
    await request(app).post('/api/v1/reports').set(mate.auth).send({ target_type: 'message', target_id: messageId, reason: 'inappropriate' });
    expect((await prisma.messageAttachment.findUniqueOrThrow({ where: { id } })).status).toBe('pending');
    expect((await link(mate.auth, id)).body.code).toBe('NOT_APPROVED');
  });
});

describe('reviewing', () => {
  it('rejecting hides the message, deletes the file, tells the sender, and is logged', async () => {
    const { owner, mate, mod, chat } = await setup();
    const id = (await sendImage(owner.auth, chat)).body.image.id as string;
    expect((await review(mod.auth, id, { action: 'reject', note: 'not ok' })).status).toBe(200);
    expect(cloud.deleted).toHaveLength(1);
    expect((await request(app).get(`/api/v1/messages/conversations/${chat}`).set(mate.auth)).body.messages).toEqual([]);
    expect(await prisma.notification.count({ where: { user_id: owner.user.id, type: 'system' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'attachment.reject' } })).toBe(1);
    expect((await link(owner.auth, id)).body.code).toBe('REMOVED');
  });

  it('an escalated rejection keeps the file as evidence and can pause the sender', async () => {
    const { owner, mod, chat } = await setup();
    const id = (await sendImage(owner.auth, chat)).body.image.id as string;
    await review(mod.auth, id, { action: 'reject', escalate: true, suspend_days: 7, note: 'serious' });
    expect(cloud.deleted).toHaveLength(0);
    expect((await prisma.messageAttachment.findUniqueOrThrow({ where: { id } })).escalated).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } })).suspended_until).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'attachment.reject_escalated' } })).toBe(1);
  });

  it('you cannot review your own image', async () => {
    const { mod, lab, chat } = await setup();
    await prisma.labMember.create({ data: { lab_id: lab.id, user_id: mod.user.id } });
    await prisma.conversationMember.create({ data: { conversation_id: chat, user_id: mod.user.id } });
    const id = (await sendImage(mod.auth, chat)).body.image.id as string;
    expect((await review(mod.auth, id, { action: 'approve' })).status).toBe(403);
  });
});
