import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { assertClean } from '../lib/guard.js';
import { SELF_HARM_MESSAGE } from '../lib/contentFilter.js';
import { createNotification } from '../lib/notify.js';

const PAGE = 50;
const pairKey = (a: string, b: string) => [a, b].sort().join(':');

/**
 * The only way two members can start talking: they follow each other, and neither has blocked the
 * other. There are no cold messages from strangers.
 */
export const canMessage = async (a: string, b: string): Promise<boolean> => {
  if (a === b) return false;
  const [blocked, follows] = await Promise.all([
    prisma.block.count({ where: { OR: [{ blocker_id: a, blocked_id: b }, { blocker_id: b, blocked_id: a }] } }),
    prisma.follow.count({ where: { OR: [{ follower_id: a, following_id: b }, { follower_id: b, following_id: a }] } }),
  ]);
  return blocked === 0 && follows === 2;
};

const NOT_CONNECTED = new HttpError(403, 'NOT_CONNECTED', 'You can message someone once you follow each other. Follow them, and ask them to follow you back.');

/** Loads a conversation only if the member belongs to it, and returns who the other person is. */
const membership = async (conversationId: string, userId: string) => {
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, members: { some: { user_id: userId } } },
    include: { members: { include: { user: { select: { id: true, username: true, avatar_url: true } } } } },
  });
  if (!convo) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found');
  const other = convo.members.find((m) => m.user_id !== userId)!.user;
  const mine = convo.members.find((m) => m.user_id === userId)!;
  return { convo, other, mine };
};

export const listConversations = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const convos = await prisma.conversation.findMany({
    where: { members: { some: { user_id: userId } } },
    orderBy: { updated_at: 'desc' },
    take: 100,
    include: {
      members: { include: { user: { select: { id: true, username: true, avatar_url: true } } } },
      messages: { where: { hidden: false }, orderBy: { created_at: 'desc' }, take: 1 },
    },
  });

  const items = await Promise.all(
    convos.map(async (c) => {
      const mine = c.members.find((m) => m.user_id === userId)!;
      const other = c.members.find((m) => m.user_id !== userId)!.user;
      const unread = await prisma.message.count({
        where: { conversation_id: c.id, hidden: false, sender_id: { not: userId }, created_at: { gt: mine.last_read_at } },
      });
      const last = c.messages[0];
      return {
        id: c.id,
        with: { username: other.username, avatar_url: other.avatar_url },
        last_message: last ? { body: last.body.length > 80 ? `${last.body.slice(0, 80)}…` : last.body, from_me: last.sender_id === userId, created_at: last.created_at } : null,
        unread,
        updated_at: c.updated_at,
        can_message: await canMessage(userId, other.id),
      };
    })
  );
  res.json({ conversations: items });
};

export const unreadCount = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const mine = await prisma.conversationMember.findMany({ where: { user_id: userId }, select: { conversation_id: true, last_read_at: true } });
  let unread = 0;
  for (const m of mine) {
    unread += await prisma.message.count({ where: { conversation_id: m.conversation_id, hidden: false, sender_id: { not: userId }, created_at: { gt: m.last_read_at } } });
  }
  res.json({ unread });
};

export const openConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  const { username } = req.body as { username: string };
  const userId = req.userId!;
  const other = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true, avatar_url: true } });
  if (!other) throw new HttpError(404, 'NOT_FOUND', 'Member not found');
  if (other.id === userId) throw new HttpError(400, 'INVALID', "You can't message yourself");
  if (!(await canMessage(userId, other.id))) throw NOT_CONNECTED;

  const key = pairKey(userId, other.id);
  const convo = await prisma.conversation.upsert({
    where: { pair_key: key },
    create: { pair_key: key, members: { create: [{ user_id: userId }, { user_id: other.id }] } },
    update: {},
  });
  res.json({ id: convo.id, with: { username: other.username, avatar_url: other.avatar_url } });
};

export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const userId = req.userId!;
  const { other, mine } = await membership(id, userId);

  // `after` is for polling: only what arrived since the last look. `before` pages back through history.
  const after = typeof req.query.after === 'string' ? new Date(req.query.after) : null;
  const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
  const validAfter = after && !Number.isNaN(after.getTime()) ? after : null;
  const validBefore = before && !Number.isNaN(before.getTime()) ? before : null;

  const rows = await prisma.message.findMany({
    where: {
      conversation_id: id,
      hidden: false,
      ...(validAfter ? { created_at: { gt: validAfter } } : {}),
      ...(validBefore ? { created_at: { lt: validBefore } } : {}),
    },
    orderBy: { created_at: validAfter ? 'asc' : 'desc' },
    take: PAGE,
  });
  const messages = (validAfter ? rows : rows.reverse()).map((m) => ({ id: m.id, body: m.body, created_at: m.created_at, from_me: m.sender_id === userId }));

  // Opening a thread marks it read up to now.
  await prisma.conversationMember.update({
    where: { conversation_id_user_id: { conversation_id: id, user_id: userId } },
    data: { last_read_at: new Date() },
  });

  res.json({
    with: { username: other.username, avatar_url: other.avatar_url },
    can_message: await canMessage(userId, other.id),
    other_last_read_at: (await prisma.conversationMember.findUnique({ where: { conversation_id_user_id: { conversation_id: id, user_id: other.id } } }))?.last_read_at ?? null,
    has_more: !validAfter && rows.length === PAGE,
    messages,
    unread_before: mine.last_read_at,
  });
};

export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { body } = req.body as { body: string };
  const userId = req.userId!;
  const { other } = await membership(id, userId);

  // Checked on every send, not just when the chat was opened: a block or an unfollow ends it.
  if (!(await canMessage(userId, other.id))) throw NOT_CONNECTED;

  const { selfHarm } = await assertClean(userId, [body], { selfHarm: 'allow' });

  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.message.create({ data: { conversation_id: id, sender_id: userId, body, created_at: now } }),
    prisma.conversation.update({ where: { id }, data: { updated_at: now } }),
    // Sending counts as having read everything up to now.
    prisma.conversationMember.update({ where: { conversation_id_user_id: { conversation_id: id, user_id: userId } }, data: { last_read_at: now } }),
  ]);

  // One nudge per burst, not one per message.
  const recent = await prisma.notification.count({
    where: { user_id: other.id, type: 'message', read: false, link: `/messages/${id}`, created_at: { gt: new Date(Date.now() - 10 * 60_000) } },
  });
  if (recent === 0) {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    await createNotification(other.id, 'message', `New message from @${me?.username}`, { link: `/messages/${id}`, payload: { conversation_id: id } });
  }

  res.status(201).json({
    id: message.id,
    body: message.body,
    created_at: message.created_at,
    from_me: true,
    ...(selfHarm ? { support: SELF_HARM_MESSAGE } : {}),
  });
};

export const markRead = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  await membership(id, req.userId!);
  await prisma.conversationMember.update({ where: { conversation_id_user_id: { conversation_id: id, user_id: req.userId! } }, data: { last_read_at: new Date() } });
  res.json({ message: 'Marked as read' });
};

export const unsend = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { count } = await prisma.message.updateMany({ where: { id, sender_id: req.userId, hidden: false }, data: { hidden: true } });
  if (count === 0) throw new HttpError(404, 'NOT_FOUND', 'Message not found');
  res.json({ message: 'Message removed' });
};
