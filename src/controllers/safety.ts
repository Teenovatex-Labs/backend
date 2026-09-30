import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';

type Target = { user_id: string | null };

/** Finds who a piece of content belongs to, and proves it exists. */
export const resolveTarget = async (type: string, id: string, reporterId?: string): Promise<Target> => {
  switch (type) {
    case 'post': {
      const p = await prisma.post.findUnique({ where: { id }, select: { author_id: true } });
      if (!p) throw new HttpError(404, 'NOT_FOUND', 'That post no longer exists');
      return { user_id: p.author_id };
    }
    case 'comment': {
      const c = await prisma.comment.findUnique({ where: { id }, select: { author_id: true } });
      if (!c) throw new HttpError(404, 'NOT_FOUND', 'That comment no longer exists');
      return { user_id: c.author_id };
    }
    case 'lab': {
      const l = await prisma.project.findUnique({ where: { id }, select: { user_id: true } });
      if (!l) throw new HttpError(404, 'NOT_FOUND', 'That lab no longer exists');
      return { user_id: l.user_id };
    }
    case 'user': {
      const u = await prisma.user.findUnique({ where: { username: id } }).catch(() => null) ?? (await prisma.user.findUnique({ where: { id } }));
      if (!u) throw new HttpError(404, 'NOT_FOUND', 'We could not find that member');
      return { user_id: u.id };
    }
    case 'message': {
      const m = await prisma.message.findUnique({ where: { id }, include: { conversation: { include: { members: { select: { user_id: true } } } } } });
      if (!m) throw new HttpError(404, 'NOT_FOUND', 'That message no longer exists');
      // Only someone in the conversation can report it: a report is the one way a moderator gets to read it.
      if (!m.conversation.members.some((x) => x.user_id === reporterId)) throw new HttpError(404, 'NOT_FOUND', 'That message no longer exists');
      return { user_id: m.sender_id };
    }
    default:
      throw new HttpError(400, 'UNSUPPORTED_TARGET', 'That kind of content cannot be reported');
  }
};

export const createReport = async (req: AuthRequest, res: Response): Promise<void> => {
  const { target_type, target_id, reason, details } = req.body as {
    target_type: 'post' | 'comment' | 'lab' | 'user' | 'message';
    target_id: string;
    reason: 'bullying' | 'inappropriate' | 'spam' | 'personal_info' | 'self_harm' | 'unsafe_contact' | 'other';
    details?: string;
  };
  const reporter_id = req.userId!;

  const target = await resolveTarget(target_type, target_id, reporter_id);
  if (target.user_id === reporter_id) throw new HttpError(400, 'SELF_REPORT', "You can't report your own content");

  // For a member report, store their id (not the username the app sent).
  const stored_target_id = target_type === 'user' ? target.user_id! : target_id;

  // Reporting the same thing twice is harmless: the first report stands and we say thanks again.
  const existing = await prisma.report.findUnique({
    where: { reporter_id_target_type_target_id: { reporter_id, target_type, target_id: stored_target_id } },
  });
  if (!existing) {
    await prisma.report.create({
      data: { reporter_id, target_type, target_id: stored_target_id, target_user_id: target.user_id, reason, details: details ?? null },
    });
  }
  res.status(201).json({ message: "Thank you. A moderator will take a look, and we'll keep your report private." });
};

// --- blocking ---------------------------------------------------------------------------

const findMember = async (username: string) => {
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } });
  if (!user) throw new HttpError(404, 'NOT_FOUND', 'Member not found');
  return user;
};

export const blockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const target = await findMember((req.params as { username: string }).username);
  if (target.id === req.userId) throw new HttpError(400, 'INVALID', "You can't block yourself");

  await prisma.$transaction([
    prisma.block.upsert({
      where: { blocker_id_blocked_id: { blocker_id: req.userId!, blocked_id: target.id } },
      create: { blocker_id: req.userId!, blocked_id: target.id },
      update: {},
    }),
    // Blocking cuts the connection both ways.
    prisma.follow.deleteMany({
      where: { OR: [{ follower_id: req.userId, following_id: target.id }, { follower_id: target.id, following_id: req.userId }] },
    }),
  ]);
  res.json({ message: `You blocked @${target.username}. You won't see each other's posts.` });
};

export const unblockUser = async (req: AuthRequest, res: Response): Promise<void> => {
  const target = await findMember((req.params as { username: string }).username);
  await prisma.block.deleteMany({ where: { blocker_id: req.userId, blocked_id: target.id } });
  res.json({ message: `You unblocked @${target.username}.` });
};

export const listBlocks = async (req: AuthRequest, res: Response): Promise<void> => {
  const blocks = await prisma.block.findMany({
    where: { blocker_id: req.userId },
    orderBy: { created_at: 'desc' },
    include: { blocked: { select: { username: true, avatar_url: true } } },
  });
  res.json({ blocks: blocks.map((b) => ({ username: b.blocked.username, avatar_url: b.blocked.avatar_url, blocked_at: b.created_at })) });
};

/** Everyone the member should not see, or be seen by: those they blocked and those who blocked them. */
export const blockedEitherWay = async (userId: string | undefined): Promise<string[]> => {
  if (!userId) return [];
  const rows = await prisma.block.findMany({
    where: { OR: [{ blocker_id: userId }, { blocked_id: userId }] },
    select: { blocker_id: true, blocked_id: true },
  });
  return [...new Set(rows.map((r) => (r.blocker_id === userId ? r.blocked_id : r.blocker_id)))];
};
