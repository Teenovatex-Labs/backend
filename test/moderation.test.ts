import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { prisma } from '../src/db.js';
import { makeProject, makeUser } from './factories.js';
import { resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const createPost = async (authorId: string, values: { title?: string; body?: string; hidden?: boolean; comment_count?: number } = {}) => {
  const space = await prisma.space.findFirst() ??
    (await prisma.space.create({ data: { slug: 'general', name: 'General', description: 'Community posts' } }));
  return prisma.post.create({
    data: {
      space_id: space.id,
      author_id: authorId,
      title: values.title ?? 'Post title',
      body: values.body ?? 'Post body',
      hidden: values.hidden ?? false,
      comment_count: values.comment_count ?? 0,
    },
  });
};

const createReport = (reporterId: string, target_type: 'post' | 'comment' | 'lab', target_id: string) =>
  prisma.report.create({
    data: { reporter_id: reporterId, target_type, target_id, reason: 'spam' },
  });

describe('moderation lists', () => {
  it('lets moderators and admins list, while denying other roles', async () => {
    const moderator = await makeUser({ role: 'moderator' });
    const admin = await makeUser({ role: 'admin' });
    const roles = await Promise.all([makeUser(), makeUser({ role: 'tutor' }), makeUser({ role: 'partner' })]);

    for (const staff of [moderator, admin]) {
      expect((await request(app).get('/api/v1/admin/moderation/posts').set(staff.auth)).status).toBe(200);
    }
    for (const user of roles) {
      expect((await request(app).get('/api/v1/admin/moderation/posts').set(user.auth)).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/moderation/posts')).status).toBe(401);
  });

  it('returns only safe excerpts and open report counts for posts, comments, and labs', async () => {
    const moderator = await makeUser({ role: 'moderator' });
    const author = await makeUser({ email: 'private@example.com', birth_date: new Date('2008-05-10T00:00:00.000Z') });
    const reporter = await makeUser();
    const post = await createPost(author.user.id, { title: 'Searchable post', body: 'A post excerpt' });
    const comment = await prisma.comment.create({ data: { post_id: post.id, author_id: author.user.id, body: 'A comment excerpt' } });
    const lab = await makeProject(author.user.id, { name: 'Searchable lab', short_description: 'A lab excerpt' });
    await createReport(reporter.user.id, 'post', post.id);

    const posts = await request(app).get('/api/v1/admin/moderation/posts').set(moderator.auth);
    const comments = await request(app).get('/api/v1/admin/moderation/comments').set(moderator.auth);
    const labs = await request(app).get('/api/v1/admin/moderation/labs').set(moderator.auth);

    expect(posts.body.items).toContainEqual({
      id: post.id,
      title: 'Searchable post',
      excerpt: 'A post excerpt',
      author: author.user.username,
      hidden: false,
      created_at: post.created_at.toISOString(),
      open_report_count: 1,
    });
    expect(comments.body.items).toContainEqual({
      id: comment.id,
      excerpt: 'A comment excerpt',
      author: author.user.username,
      hidden: false,
      created_at: comment.created_at.toISOString(),
      open_report_count: 0,
    });
    expect(labs.body.items).toContainEqual({
      id: lab.id,
      title: 'Searchable lab',
      excerpt: 'A lab excerpt',
      author: author.user.username,
      hidden: false,
      created_at: lab.created_at.toISOString(),
      open_report_count: 0,
    });
    expect(JSON.stringify([posts.body, comments.body, labs.body])).not.toContain(author.user.email);
    expect(JSON.stringify([posts.body, comments.body, labs.body])).not.toContain('birth_date');
  });

  it('filters by hidden state, open reports, text, date range, and cursor', async () => {
    const moderator = await makeUser({ role: 'moderator' });
    const author = await makeUser();
    const reporter = await makeUser();
    const first = await createPost(author.user.id, { title: 'needle first' });
    const second = await createPost(author.user.id, { title: 'needle second', hidden: true });
    await createReport(reporter.user.id, 'post', first.id);

    const hidden = await request(app).get('/api/v1/admin/moderation/posts?hidden=true').set(moderator.auth);
    expect(hidden.body.items.map((item: { id: string }) => item.id)).toContain(second.id);
    expect(hidden.body.items.map((item: { id: string }) => item.id)).not.toContain(first.id);

    const reported = await request(app).get('/api/v1/admin/moderation/posts?reported=true').set(moderator.auth);
    expect(reported.body.items.map((item: { id: string }) => item.id)).toEqual([first.id]);
    const unreported = await request(app).get('/api/v1/admin/moderation/posts?reported=false').set(moderator.auth);
    expect(unreported.body.items.map((item: { id: string }) => item.id)).toEqual([second.id]);
    const matching = await request(app).get('/api/v1/admin/moderation/posts?q=needle').set(moderator.auth);
    expect(matching.body.items).toHaveLength(2);
    const dateFiltered = await request(app).get('/api/v1/admin/moderation/posts?from=2030-01-01T00:00:00Z').set(moderator.auth);
    expect(dateFiltered.body.items).toHaveLength(0);
    const invalidRange = await request(app)
      .get('/api/v1/admin/moderation/posts?from=2030-01-02T00:00:00Z&to=2030-01-01T00:00:00Z')
      .set(moderator.auth);
    expect(invalidRange.status).toBe(400);

    const page = await request(app).get('/api/v1/admin/moderation/posts?limit=1').set(moderator.auth);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.next_cursor).toBeTruthy();
    const next = await request(app)
      .get(`/api/v1/admin/moderation/posts?limit=1&cursor=${page.body.next_cursor}`)
      .set(moderator.auth);
    expect(next.body.items).toHaveLength(1);
    expect(next.body.items[0].id).not.toBe(page.body.items[0].id);

    const invalid = await request(app).get('/api/v1/admin/moderation/posts?limit=101').set(moderator.auth);
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('moderation hide and restore', () => {
  it('hides and restores posts and labs with audit entries', async () => {
    const moderator = await makeUser({ role: 'moderator' });
    const admin = await makeUser({ role: 'admin' });
    const owner = await makeUser();
    const post = await createPost(owner.user.id);
    const lab = await makeProject(owner.user.id);

    for (const [type, id, auth] of [
      ['post', post.id, moderator.auth],
      ['lab', lab.id, admin.auth],
    ] as const) {
      const hidden = await request(app).post(`/api/v1/admin/moderation/${type}/${id}/hide`).set(auth);
      expect(hidden.status).toBe(200);
      const restored = await request(app).post(`/api/v1/admin/moderation/${type}/${id}/restore`).set(auth);
      expect(restored.status).toBe(200);
    }

    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).hidden).toBe(false);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: lab.id } })).hidden).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: 'moderation.hide' } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'moderation.restore' } })).toBe(2);
  });

  it('updates comment counts and audits each visibility change', async () => {
    const moderator = await makeUser({ role: 'moderator' });
    const owner = await makeUser();
    const post = await createPost(owner.user.id, { comment_count: 1 });
    const comment = await prisma.comment.create({ data: { post_id: post.id, author_id: owner.user.id, body: 'Comment' } });

    expect((await request(app).post(`/api/v1/admin/moderation/comment/${comment.id}/hide`).set(moderator.auth)).status).toBe(200);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).comment_count).toBe(0);
    expect((await request(app).post(`/api/v1/admin/moderation/comment/${comment.id}/restore`).set(moderator.auth)).status).toBe(200);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).comment_count).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: { in: ['moderation.hide', 'moderation.restore'] } } })).toBe(2);
  });

  it('requires moderation permissions and rejects duplicate or missing state changes', async () => {
    const moderator = await makeUser({ role: 'moderator' });
    const member = await makeUser();
    const owner = await makeUser();
    const post = await createPost(owner.user.id);

    expect((await request(app).post(`/api/v1/admin/moderation/post/${post.id}/hide`).set(member.auth)).status).toBe(403);
    expect((await request(app).post(`/api/v1/admin/moderation/post/${post.id}/hide`).set(moderator.auth)).status).toBe(200);
    const duplicate = await request(app).post(`/api/v1/admin/moderation/post/${post.id}/hide`).set(moderator.auth);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('ALREADY_HIDDEN');
    const missing = await request(app).post('/api/v1/admin/moderation/post/00000000-0000-4000-8000-000000000000/hide').set(moderator.auth);
    expect(missing.status).toBe(404);
  });
});

describe('moderation stats', () => {
  it('returns queue stats, caller actions and an admin-only moderator breakdown', async () => {
    const now = new Date();
    const moderator = await makeUser({ role: 'moderator' });
    const idleModerator = await makeUser({ role: 'moderator' });
    const admin = await makeUser({ role: 'admin' });
    const member = await makeUser();
    const reporter = await makeUser();
    const suspended = await makeUser({ suspended_until: new Date(now.getTime() + 60_000) });
    await makeUser({ suspended_until: new Date(now.getTime() - 60_000) });

    await prisma.report.createMany({
      data: [
        { reporter_id: reporter.user.id, target_type: 'post', target_id: 'old-report', reason: 'spam', created_at: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
        { reporter_id: reporter.user.id, target_type: 'comment', target_id: 'recent-report', reason: 'spam', created_at: new Date(now.getTime() - 60 * 60 * 1000) },
        { reporter_id: reporter.user.id, target_type: 'lab', target_id: 'closed-report', reason: 'spam', status: 'dismissed' },
      ],
    });

    const conversation = await prisma.conversation.create({
      data: { members: { create: { user_id: suspended.user.id } } },
    });
    const message = await prisma.message.create({
      data: { conversation_id: conversation.id, sender_id: suspended.user.id, body: 'Image review fixture' },
    });
    await prisma.messageAttachment.create({
      data: { message_id: message.id, uploader_id: suspended.user.id, public_id: 'pending-review', width: 10, height: 10 },
    });
    const approvedConversation = await prisma.conversation.create({
      data: { members: { create: { user_id: reporter.user.id } } },
    });
    const approvedMessage = await prisma.message.create({
      data: { conversation_id: approvedConversation.id, sender_id: reporter.user.id, body: 'Approved image fixture' },
    });
    await prisma.messageAttachment.create({
      data: {
        message_id: approvedMessage.id,
        uploader_id: reporter.user.id,
        public_id: 'approved-image',
        width: 10,
        height: 10,
        status: 'approved',
      },
    });

    await prisma.auditLog.createMany({
      data: [
        { actor_id: moderator.user.id, action: 'moderation.hide', created_at: new Date(now.getTime() - 60_000) },
        { actor_id: moderator.user.id, action: 'report.warn', created_at: new Date(now.getTime() - 30_000) },
        { actor_id: idleModerator.user.id, action: 'moderation.restore', created_at: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000) },
      ],
    });

    const moderatorResponse = await request(app).get('/api/v1/admin/moderation/stats').set(moderator.auth);
    expect(moderatorResponse.status).toBe(200);
    expect(moderatorResponse.body).toMatchObject({
      open_reports: 2,
      open_image_reviews: 1,
      suspended_users: 1,
      my_actions_7d: 2,
    });
    expect(moderatorResponse.body.oldest_open_report_age_seconds).toBeGreaterThanOrEqual(7199);
    expect(moderatorResponse.body.oldest_open_report_age_seconds).toBeLessThanOrEqual(7201);
    expect(moderatorResponse.body).not.toHaveProperty('moderator_actions_7d');
    expect((await request(app).get('/api/v1/admin/moderation/stats').set(member.auth)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/moderation/stats')).status).toBe(401);

    const adminResponse = await request(app).get('/api/v1/admin/moderation/stats').set(admin.auth);
    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body.moderator_actions_7d).toEqual([
      { username: idleModerator.user.username, actions: 0 },
      { username: moderator.user.username, actions: 2 },
    ].sort((a, b) => a.username.localeCompare(b.username)));
  });
});
