import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { cleanLink } from '../src/lib/onboarding.js';
import { makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(async () => {
  await resetDb();
  config.onboarding.hcbUrl = 'https://hcb.hackclub.com/donations/start/teenovatex?utm_source=chatgpt.com';
});
afterAll(() => prisma.$disconnect());

const newcomer = () => makeUser({ membership_status: 'onboarding', onboarding_due_at: new Date(Date.now() + 7 * 86400000) });
const get = (auth: Record<string, string>) => request(app).get('/api/v1/onboarding').set(auth);
const confirm = (auth: Record<string, string>, step: string) => request(app).post(`/api/v1/onboarding/steps/${step}`).set(auth);

describe('onboarding', () => {
  it('lists the steps with clean links and a due date', async () => {
    const { auth } = await newcomer();
    const res = await get(auth);
    expect(res.body.status).toBe('onboarding');
    expect(res.body.steps.map((s: { key: string }) => s.key)).toEqual(['welcome', 'conduct', 'safeguarding', 'profile', 'whatsapp', 'intro', 'hcb']);
    expect(res.body.steps.find((s: { key: string }) => s.key === 'hcb').link).toBe('https://hcb.hackclub.com/donations/start/teenovatex');
    expect(res.body.steps.find((s: { key: string }) => s.key === 'conduct').link).toBe('https://www.teenovatex.org/conduct');
    expect(res.body.overdue).toBe(false);
  });

  it('keeps an accepted member out of active community actions until setup is complete', async () => {
    const { auth, user } = await newcomer();
    const profile = await request(app).get('/api/v1/users/me').set(auth);
    expect(profile.body.membership_status).toBe('onboarding');
    const blocked = await request(app).post('/api/v1/community/spaces/anything/posts').set(auth).send({});
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('ONBOARDING_REQUIRED');

    for (const step of ['welcome', 'conduct', 'safeguarding', 'whatsapp', 'hcb']) await confirm(auth, step);
    await prisma.user.update({ where: { id: user.id }, data: { bio: 'I like building small web apps.' } });
    await request(app).put('/api/v1/onboarding/intro').set(auth).send({ intro: 'I build small web apps and want to learn design.' });
    expect((await request(app).get('/api/v1/users/me').set(auth)).body.membership_status).toBe('active');
    const unblocked = await request(app).post('/api/v1/community/spaces/anything/posts').set(auth).send({});
    expect(unblocked.body.code).not.toBe('ONBOARDING_REQUIRED');
  });

  it('activates the member once every required step is done, and not before', async () => {
    const { auth, user } = await newcomer();
    for (const s of ['welcome', 'conduct', 'safeguarding', 'hcb']) await confirm(auth, s);
    expect((await confirm(auth, 'whatsapp')).body.status).toBe('onboarding');
    await prisma.user.update({ where: { id: user.id }, data: { bio: 'I like building small web apps.' } });
    expect((await get(auth)).body.status).toBe('onboarding');
    const intro = await request(app).put('/api/v1/onboarding/intro').set(auth).send({ intro: 'I build small web apps and want to learn design.' });
    expect(intro.body.whatsapp_text).toMatch(/^Hi everyone, I'm Test\./);
    const done = await get(auth);
    expect(done.body.status).toBe('active');
    expect(done.body.due_at).toBeNull();
    expect(await prisma.membershipEvent.count({ where: { user_id: user.id, to_status: 'active' } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).intro_published_at).not.toBeNull();
  });

  it('keeps a member in onboarding until they confirm joining HCB', async () => {
    const { auth } = await makeUser({ membership_status: 'onboarding', bio: 'Long enough bio text', intro: 'A long enough introduction to the group.' });
    for (const s of ['welcome', 'conduct', 'safeguarding']) await confirm(auth, s);
    expect((await confirm(auth, 'whatsapp')).body.status).toBe('onboarding');
    expect((await confirm(auth, 'hcb')).body.status).toBe('active');
  });

  it('rejects unknown steps and steps from members not in onboarding', async () => {
    const { auth } = await newcomer();
    expect((await confirm(auth, 'profile')).status).toBe(404);
    const active = await makeUser();
    expect((await confirm(active.auth, 'conduct')).status).toBe(409);
  });

  it('reports overdue without removing anyone', async () => {
    const { auth } = await makeUser({ membership_status: 'onboarding', onboarding_due_at: new Date(Date.now() - 1000) });
    const res = await get(auth);
    expect(res.body.overdue).toBe(true);
    expect(res.body.status).toBe('onboarding');
  });

  it('lets an admin extend the deadline with a reason, capped and audited', async () => {
    const { user } = await newcomer();
    const admin = await makeUser({ role: 'admin' });
    const mod = await makeUser({ role: 'moderator' });
    const url = `/api/v1/admin/onboarding/${user.id}/extend`;
    expect((await request(app).post(url).set(mod.auth).send({ days: 3, reason: 'Exams this week' })).status).toBe(403);
    expect((await request(app).post(url).set(admin.auth).send({ days: 30, reason: 'Exams this week' })).status).toBe(400);
    expect((await request(app).post(url).set(admin.auth).send({ days: 3 })).status).toBe(400);
    const ok = await request(app).post(url).set(admin.auth).send({ days: 3, reason: 'Exams this week' });
    expect(ok.status).toBe(200);
    const due = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).onboarding_due_at!;
    expect(due.getTime()).toBeGreaterThan(Date.now() + 9.9 * 86400000);
    expect(await prisma.auditLog.count({ where: { action: 'onboarding.extend' } })).toBe(1);
  });
});

describe('cleanLink', () => {
  it('strips tracking parameters and keeps the rest', () => {
    expect(cleanLink('https://x.org/a?b=1&utm_source=z&fbclid=q')).toBe('https://x.org/a?b=1');
    expect(cleanLink(undefined)).toBeNull();
    expect(cleanLink('not a url')).toBeNull();
  });

  it('suggests a bio from the application and only saves what the member sends', async () => {
    const { auth, user } = await newcomer();
    const w = await prisma.applicationWindow.create({ data: { opens_at: new Date(Date.now() - 9e8), closes_at: new Date(Date.now() - 8e8), decisions_publish_at: new Date(Date.now() - 7e8), form_version: 'v1' } });
    await prisma.application.create({
      data: { reference: 'TX-2026-00077', window_id: w.id, status: 'accepted', submitted_at: new Date(), email: user.email, full_name: 'Test Member', birth_date: new Date('2010-01-01'), country: 'NG', city: 'Lagos', whatsapp: '+234', education_level: 'secondary', interests: ['robots', 'music'], current_skills: [], learning_goals: ['python'], resume_token_hash: 'h'.repeat(64), resume_expires_at: new Date() },
    });
    const s = await request(app).get('/api/v1/onboarding/profile-suggestion').set(auth);
    expect(s.body.bio).toBe("I'm Test. I'm into robots and music. I want to learn python.");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).bio).toBeNull();
    expect((await request(app).put('/api/v1/onboarding/bio').set(auth).send({ bio: s.body.bio })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).bio).toBe(s.body.bio);
  });
});
