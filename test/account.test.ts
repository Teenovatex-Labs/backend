import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/google.js', () => ({
  verifyGoogleToken: async (token: string) => (token === 'valid-for-google-1' ? { sub: 'google-1' } : null),
}));

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/db.js');
const { makeUser } = await import('./factories.js');
const { resetDb } = await import('./helpers.js');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const del = (auth: Record<string, string>, body: object) =>
  request(app).delete('/api/v1/settings/account').set(auth).send(body);

describe('deleting an account', () => {
  it('needs the right password for a password account', async () => {
    const { user, auth } = await makeUser({ password_hash: await bcrypt.hash('Sup3rSecret', 4) });
    expect((await del(auth, { password: 'wrong' })).status).toBe(400);
    expect((await del(auth, {})).status).toBe(400);
    expect(await prisma.user.count()).toBe(1);
    expect((await del(auth, { password: 'Sup3rSecret' })).status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it('does not let a Google-only account be deleted with any old string', async () => {
    const { auth } = await makeUser({ google_id: 'google-1' });
    const res = await del(auth, { password: 'anything' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('GOOGLE_CONFIRMATION_REQUIRED');
    expect((await del(auth, { id_token: 'forged' })).status).toBe(400);
    expect(await prisma.user.count()).toBe(1);
  });

  it('deletes a Google-only account once Google confirms it is them', async () => {
    const { auth } = await makeUser({ google_id: 'google-1' });
    expect((await del(auth, { id_token: 'valid-for-google-1' })).status).toBe(200);
    expect(await prisma.user.count()).toBe(0);
  });

  it('rejects a Google token that belongs to someone else', async () => {
    const { auth } = await makeUser({ google_id: 'google-2' });
    expect((await del(auth, { id_token: 'valid-for-google-1' })).status).toBe(400);
    expect(await prisma.user.count()).toBe(1);
  });
});
