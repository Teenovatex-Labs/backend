import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/middleware/upload.js', async (orig) => ({
  ...(await orig<typeof import('../src/middleware/upload.js')>()),
  uploadToCloudinary: vi.fn(async (_b: Buffer, folder: string) => `https://cdn.example/${folder}/x.png`),
}));

import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { sanitizeSvg, SvgRejected } from '../src/lib/svgSanitize.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const base = { slug: 'teenovator-of-the-month', name: 'Teenovator of the Month', description: 'Honoured for a standout month', criteria_text: 'Initiative, contribution, consistency and real-world impact.' };
const create = (auth: Record<string, string>, over: Record<string, unknown> = {}) => request(app).post('/api/v1/admin/badges').set(auth).send({ ...base, ...over });

const GOOD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="gold"/></svg>';

describe('safe SVG', () => {
  const hostile: [string, string][] = [
    ['script element', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="5" height="5"/></svg>'],
    ['event handler', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="5" height="5" onclick="x()"/></svg>'],
    ['foreignObject', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>hi</div></foreignObject><rect width="5" height="5"/></svg>'],
    ['external image', '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil.test/x.png"/><rect width="5" height="5"/></svg>'],
    ['css import', '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(http://evil.test/a.css);</style><rect width="5" height="5"/></svg>'],
    ['external url paint', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" fill="url(http://evil.test/a)"/></svg>'],
    ['javascript link', '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="5" height="5"/></a></svg>'],
    ['inline style', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" style="fill:url(http://evil.test)"/></svg>'],
    ['data uri', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" fill="data:text/html,x"/></svg>'],
    ['use element', '<svg xmlns="http://www.w3.org/2000/svg"><use href="http://evil.test/a.svg#x"/><rect width="5" height="5"/></svg>'],
  ];
  it.each(hostile)('neutralises: %s', (_name, svg) => {
    const out = sanitizeSvg(svg).toLowerCase();
    for (const bad of ['script', 'onload', 'onclick', 'foreignobject', 'evil.test', '@import', 'javascript', 'style=', 'data:', '<image', '<use', '<a ']) expect(out).not.toContain(bad);
    expect(out).toContain('<rect');
  });

  it('refuses entities, doctypes, oversized files, non-svg and empty drawings', () => {
    expect(() => sanitizeSvg('<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')).toThrow(SvgRejected);
    expect(() => sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/>${' '.repeat(210 * 1024)}</svg>`)).toThrow(SvgRejected);
    expect(() => sanitizeSvg('<html><body/></html>')).toThrow(SvgRejected);
    expect(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>')).toThrow(SvgRejected);
  });

  it('keeps legitimate artwork and internal gradients', () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="gold"/></linearGradient></defs><circle cx="5" cy="5" r="4" fill="url(#g)"/></svg>');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('linearGradient');
  });
});

describe('badge management', () => {
  it('lets only admins manage and award', async () => {
    const mod = await makeUser({ role: 'moderator' });
    const member = await makeUser();
    expect((await create(mod.auth)).status).toBe(403);
    expect((await create(member.auth)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/badges')).status).toBe(401);
  });

  it('creates, updates and deactivates (never deletes), with an audit trail', async () => {
    const admin = await makeUser({ role: 'admin' });
    const made = await create(admin.auth);
    expect(made.status).toBe(201);
    expect((await create(admin.auth)).status).toBe(409);
    const off = await request(app).patch(`/api/v1/admin/badges/${made.body.id}`).set(admin.auth).send({ active: false });
    expect(off.body.active).toBe(false);
    expect((await request(app).delete(`/api/v1/admin/badges/${made.body.id}`).set(admin.auth)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: { in: ['badge.create', 'badge.update'] } } })).toBe(2);
  });

  it('uploads PNG and SVG art, rejecting oversize, wrong type and hostile SVG', async () => {
    const admin = await makeUser({ role: 'admin' });
    const b = (await create(admin.auth)).body;
    const url = `/api/v1/admin/badges/${b.id}/image`;
    const png = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#fc0' } }).png().toBuffer();
    const ok = await request(app).post(url).set(admin.auth).attach('image', png, { filename: 'a.png', contentType: 'image/png' });
    expect(ok.status).toBe(200);
    expect(ok.body.image_kind).toBe('png');
    expect((await request(app).post(url).set(admin.auth).attach('image', Buffer.alloc(1_100_000), { filename: 'a.png', contentType: 'image/png' })).body.code).toBe('TOO_LARGE');
    expect((await request(app).post(url).set(admin.auth).attach('image', Buffer.from('not an image'), { filename: 'a.png', contentType: 'image/png' })).body.code).toBe('BAD_IMAGE');
    expect((await request(app).post(url).set(admin.auth).attach('image', png, { filename: 'a.gif', contentType: 'image/gif' })).body.code).toBe('INVALID_FILE_TYPE');
    expect((await request(app).post(url).set(admin.auth).attach('image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'), { filename: 'a.svg', contentType: 'image/svg+xml' })).body.code).toBe('BAD_SVG');

    const svg = await request(app).post(url).set(admin.auth).attach('image', Buffer.from(GOOD), { filename: 'a.svg', contentType: 'image/svg+xml' });
    expect(svg.body).toMatchObject({ image_kind: 'svg', image_url: `/api/v1/badges/${b.slug}/image.svg` });
    expect(svg.body.fallback_url).toContain('cdn.example');
    const served = await request(app).get(`/api/v1/badges/${b.slug}/image.svg`);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/svg+xml');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-security-policy']).toContain("default-src 'none'");
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});

describe('awards and profiles', () => {
  const setup = async () => {
    const admin = await makeUser({ role: 'admin' });
    const winner = await makeUser();
    const badge = (await create(admin.auth)).body;
    const award = (auth: Record<string, string>, userId: string, over: Record<string, unknown> = {}) =>
      request(app).post(`/api/v1/admin/badges/${badge.id}/award`).set(auth).send({ user_id: userId, reason: 'Outstanding month', ...over });
    return { admin, winner, badge, award };
  };

  it('awards once, notifies, audits, and refuses self-awards and duplicates', async () => {
    const { admin, winner, award } = await setup();
    expect((await award(admin.auth, admin.user.id)).body.code).toBe('SELF_AWARD');
    expect((await award(admin.auth, winner.user.id)).status).toBe(201);
    expect((await award(admin.auth, winner.user.id)).body.code).toBe('ALREADY_AWARDED');
    expect(await prisma.notification.count({ where: { user_id: winner.user.id, type: 'badge' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'badge.award' } })).toBe(1);
    expect((await award(winner.auth, winner.user.id)).status).toBe(403);
  });

  it('allows repeats only for repeatable badges, and none for an inactive one', async () => {
    const { admin, winner, badge, award } = await setup();
    await request(app).patch(`/api/v1/admin/badges/${badge.id}`).set(admin.auth).send({ repeatable: true });
    expect((await award(admin.auth, winner.user.id)).status).toBe(201);
    expect((await award(admin.auth, winner.user.id)).status).toBe(201);
    await request(app).patch(`/api/v1/admin/badges/${badge.id}`).set(admin.auth).send({ active: false });
    expect((await award(admin.auth, winner.user.id)).body.code).toBe('INACTIVE');
  });

  it('shows honours on a public profile, hides them on a private one, and always shows the owner', async () => {
    const { admin, winner, award } = await setup();
    await award(admin.auth, winner.user.id);
    const stranger = await makeUser();
    const pub = await request(app).get(`/api/v1/users/${winner.user.username}`).set(stranger.auth);
    expect(pub.body.honors).toHaveLength(1);
    expect(pub.body.honors[0]).toMatchObject({ name: 'Teenovator of the Month', tier: 'high' });
    await prisma.userSettings.update({ where: { user_id: winner.user.id }, data: { public_profile: false } });
    const priv = await request(app).get(`/api/v1/users/${winner.user.username}`).set(stranger.auth);
    expect(priv.body.private).toBe(true);
    expect(priv.body.honors).toBeUndefined();
    expect((await request(app).get(`/api/v1/users/${winner.user.username}`).set(winner.auth)).body.honors).toHaveLength(1);
  });

  it('revoking removes the honour, clears featuring, and is audited once', async () => {
    const { admin, winner, award } = await setup();
    const a = (await award(admin.auth, winner.user.id)).body;
    expect((await request(app).patch('/api/v1/users/me/badges/featured').set(winner.auth).send({ award_ids: [a.id] })).status).toBe(200);
    expect((await request(app).post(`/api/v1/admin/badge-awards/${a.id}/revoke`).set(admin.auth).send({ reason: 'Awarded in error' })).status).toBe(200);
    expect((await request(app).post(`/api/v1/admin/badge-awards/${a.id}/revoke`).set(admin.auth).send({ reason: 'Awarded in error' })).body.code).toBe('ALREADY_REVOKED');
    expect((await request(app).get(`/api/v1/users/${winner.user.username}`).set(winner.auth)).body.honors).toHaveLength(0);
    expect((await prisma.badgeAward.findUniqueOrThrow({ where: { id: a.id } })).featured).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: 'badge.revoke' } })).toBe(1);
  });

  it('lets a member feature up to three of their own, and nobody else’s', async () => {
    const { admin, winner, badge, award } = await setup();
    await request(app).patch(`/api/v1/admin/badges/${badge.id}`).set(admin.auth).send({ repeatable: true });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await award(admin.auth, winner.user.id)).body.id);
    const f = (auth: Record<string, string>, award_ids: string[]) => request(app).patch('/api/v1/users/me/badges/featured').set(auth).send({ award_ids });
    expect((await f(winner.auth, ids)).status).toBe(400); // four is too many
    expect((await f(winner.auth, ids.slice(0, 2))).status).toBe(200);
    const other = await makeUser();
    expect((await f(other.auth, [ids[0]!])).body.code).toBe('NOT_YOURS');
    const profile = await request(app).get(`/api/v1/users/${winner.user.username}`).set(winner.auth);
    expect(profile.body.honors.slice(0, 2).every((h: { featured: boolean }) => h.featured)).toBe(true);
  });
});
