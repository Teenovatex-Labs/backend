import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { assertClean } from '../lib/guard.js';
import { SELF_HARM_MESSAGE } from '../lib/contentFilter.js';
import { createNotification } from '../lib/notify.js';
import { blockedEitherWay } from './safety.js';
import { publish } from '../lib/realtime.js';
import { assertCanSendImage, cleanImage } from '../lib/attachments.js';
import { signedImageUrl, uploadPrivateImage } from '../middleware/upload.js';

const PAGE = 50;
const pairKey = (a: string, b: string) => [a, b].sort().join(':');

/**
 * Anyone can message anyone who shares their username, unless either has blocked the other. Nobody
 * is ranked above anybody else here, so there is no follow step and no popularity gate. Blocks, the
 * content filter, reports and suspensions are what keep it safe.
 */
export const canMessage = async (a: string, b: string): Promise<boolean> => {
  if (a === b) return false;
  const blocked = await prisma.block.count({ where: { OR: [{ blocker_id: a, blocked_id: b }, { blocker_id: b, blocked_id: a }] } });
  return blocked === 0;
};

const NOT_CONNECTED = new HttpError(403, 'NOT_CONNECTED', "You can't message this person.");

const person = { select: { id: true, username: true, avatar_url: true } } as const;

/** Loads a conversation only if the member belongs to it. `other` is the second person in a private chat, null in a lab chat. */
const membership = async (conversationId: string, userId: string) => {
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, members: { some: { user_id: userId } } },
    include: { members: { include: { user: person } }, lab: { select: { name: true, slug: true } } },
  });
  if (!convo) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found');
  const other = convo.lab_id ? null : convo.members.find((m) => m.user_id !== userId)!.user;
  const mine = convo.members.find((m) => m.user_id === userId)!;
  return { convo, other, mine };
};

/** How a conversation is named and shown to the member: a person, or a lab team. */
const describe = (convo: { lab: { name: string; slug: string } | null; members: { user: { username: string; avatar_url: string | null } }[] }, other: { username: string; avatar_url: string | null } | null) =>
  convo.lab
    ? { username: convo.lab.name, avatar_url: null, group: true as const, lab_slug: convo.lab.slug, member_count: convo.members.length }
    : { username: other!.username, avatar_url: other!.avatar_url, group: false as const };

export const listConversations = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const hidden = await blockedEitherWay(userId);
  const convos = await prisma.conversation.findMany({
    where: { members: { some: { user_id: userId } } },
    orderBy: { updated_at: 'desc' },
    take: 100,
    include: {
      members: { include: { user: person } },
      lab: { select: { name: true, slug: true } },
      messages: { where: { hidden: false, ...(hidden.length ? { sender_id: { notIn: hidden } } : {}) }, orderBy: { created_at: 'desc' }, take: 1 },
    },
  });

  const items = await Promise.all(
    convos.map(async (c) => {
      const mine = c.members.find((m) => m.user_id === userId)!;
      const other = c.lab_id ? null : c.members.find((m) => m.user_id !== userId)!.user;
      const unread = await prisma.message.count({
        where: { conversation_id: c.id, hidden: false, sender_id: { not: userId, ...(hidden.length ? { notIn: hidden } : {}) }, created_at: { gt: mine.last_read_at } },
      });
      const last = c.messages[0];
      const senderName = last && c.lab_id ? c.members.find((m) => m.user_id === last.sender_id)?.user.username : undefined;
      return {
        id: c.id,
        with: describe(c, other),
        last_message: last
          ? { body: last.body.length > 80 ? `${last.body.slice(0, 80)}…` : last.body, from_me: last.sender_id === userId, created_at: last.created_at, ...(senderName ? { from_name: senderName } : {}) }
          : null,
        unread,
        updated_at: c.updated_at,
        can_message: other ? await canMessage(userId, other.id) : true,
      };
    })
  );
  res.json({ conversations: items });
};

export const unreadCount = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const hidden = await blockedEitherWay(userId);
  const mine = await prisma.conversationMember.findMany({ where: { user_id: userId }, select: { conversation_id: true, last_read_at: true } });
  let unread = 0;
  for (const m of mine) {
    unread += await prisma.message.count({
      where: { conversation_id: m.conversation_id, hidden: false, sender_id: { not: userId, ...(hidden.length ? { notIn: hidden } : {}) }, created_at: { gt: m.last_read_at } },
    });
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
  res.json({ id: convo.id, with: { username: other.username, avatar_url: other.avatar_url, group: false } });
};

/** The team chat for a lab: created the first time a team member opens it, with the whole team in it. */
export const openLabChat = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const userId = req.userId!;
  const lab = await prisma.project.findFirst({
    where: { OR: [{ id }, { slug: id }], members: { some: { user_id: userId } } },
    select: { id: true, name: true, slug: true, members: { select: { user_id: true } } },
  });
  if (!lab) throw new HttpError(403, 'NOT_ON_TEAM', 'Only the lab team can open its chat');

  const convo = await prisma.conversation.upsert({
    where: { lab_id: lab.id },
    create: { lab_id: lab.id, members: { create: lab.members.map((m) => ({ user_id: m.user_id })) } },
    update: {},
  });
  // Anyone on the team who is not in it yet (joined before the chat existed) is added now.
  await prisma.conversationMember.createMany({ data: lab.members.map((m) => ({ conversation_id: convo.id, user_id: m.user_id })), skipDuplicates: true });
  res.json({ id: convo.id, with: { username: lab.name, avatar_url: null, group: true, lab_slug: lab.slug } });
};

/** Keeps a lab chat's membership in step with the team. Called when someone joins, is added, or leaves. */
export const syncLabChatMember = async (labId: string, userId: string, present: boolean): Promise<void> => {
  const convo = await prisma.conversation.findUnique({ where: { lab_id: labId }, select: { id: true } });
  if (!convo) return; // no chat yet; it will include everyone when it is first opened
  if (present) await prisma.conversationMember.createMany({ data: [{ conversation_id: convo.id, user_id: userId }], skipDuplicates: true });
  else await prisma.conversationMember.deleteMany({ where: { conversation_id: convo.id, user_id: userId } });
};

export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const userId = req.userId!;
  const { convo, other, mine } = await membership(id, userId);
  const hidden = await blockedEitherWay(userId);

  // `after` is for polling: only what arrived since the last look. `before` pages back through history.
  const after = typeof req.query.after === 'string' ? new Date(req.query.after) : null;
  const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
  const validAfter = after && !Number.isNaN(after.getTime()) ? after : null;
  const validBefore = before && !Number.isNaN(before.getTime()) ? before : null;

  const rows = await prisma.message.findMany({
    where: {
      conversation_id: id,
      hidden: false,
      // In a team chat, people you blocked (or who blocked you) stay out of your view.
      ...(convo.lab_id && hidden.length ? { sender_id: { notIn: hidden } } : {}),
      ...(validAfter ? { created_at: { gt: validAfter } } : {}),
      ...(validBefore ? { created_at: { lt: validBefore } } : {}),
    },
    orderBy: { created_at: validAfter ? 'asc' : 'desc' },
    take: PAGE,
    include: { attachment: { select: { id: true, status: true, width: true, height: true } } },
  });
  const names = new Map(convo.members.map((m) => [m.user_id, m.user.username]));
  const messages = (validAfter ? rows : rows.reverse()).map((m) => ({
    id: m.id,
    body: m.body,
    created_at: m.created_at,
    from_me: m.sender_id === userId,
    ...(convo.lab_id ? { from_name: names.get(m.sender_id) ?? 'former member' } : {}),
    image: m.attachment ? { id: m.attachment.id, status: m.attachment.status, width: m.attachment.width, height: m.attachment.height } : null,
  }));

  // Opening a thread marks it read up to now.
  await prisma.conversationMember.update({
    where: { conversation_id_user_id: { conversation_id: id, user_id: userId } },
    data: { last_read_at: new Date() },
  });

  res.json({
    with: describe(convo, other),
    can_message: other ? await canMessage(userId, other.id) : true,
    other_last_read_at: other ? (convo.members.find((m) => m.user_id === other.id)?.last_read_at ?? null) : null,
    has_more: !validAfter && rows.length === PAGE,
    messages,
    unread_before: mine.last_read_at,
  });
};

export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { body } = req.body as { body: string };
  const userId = req.userId!;
  const { convo, other } = await membership(id, userId);

  // Checked on every send, not just when the chat was opened: a block ends a private
  // chat. A team chat needs no check here because membership itself is the permission.
  if (other && !(await canMessage(userId, other.id))) throw NOT_CONNECTED;

  const { selfHarm } = await assertClean(userId, [body], { selfHarm: 'allow' });

  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.message.create({ data: { conversation_id: id, sender_id: userId, body, created_at: now } }),
    prisma.conversation.update({ where: { id }, data: { updated_at: now } }),
    // Sending counts as having read everything up to now.
    prisma.conversationMember.update({ where: { conversation_id_user_id: { conversation_id: id, user_id: userId } }, data: { last_read_at: now } }),
  ]);

  // One nudge per burst per person, not one per message. In a team chat everyone else is told, except
  // people who have blocked the sender (or the other way round).
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  const hidden = await blockedEitherWay(userId);
  const recipients = convo.members.map((m) => m.user_id).filter((u) => u !== userId && !hidden.includes(u));
  for (const recipient of recipients) {
    publish(recipient, { type: 'message', conversation_id: id });
    const recent = await prisma.notification.count({
      where: { user_id: recipient, type: 'message', read: false, link: `/messages/${id}`, created_at: { gt: new Date(Date.now() - 10 * 60_000) } },
    });
    if (recent === 0) {
      const where = convo.lab ? ` in ${convo.lab.name}` : '';
      await createNotification(recipient, 'message', `New message${where} from @${me?.username}`, { link: `/messages/${id}`, payload: { conversation_id: id } });
    }
  }

  res.status(201).json({
    id: message.id,
    body: message.body,
    created_at: message.created_at,
    from_me: true,
    ...(convo.lab_id ? { from_name: me?.username } : {}),
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

// --- images in team chats -----------------------------------------------------------------------
// Phase one of attachments: images only, in lab team chats only, and nobody but the sender and the
// moderators sees one until a moderator approves it.

export const sendImage = async (req: AuthRequest & { file?: Express.Multer.File }, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const userId = req.userId!;
  if (!req.file) throw new HttpError(400, 'NO_FILE', 'Choose an image to send');
  const caption = typeof (req.body as { body?: unknown }).body === 'string' ? (req.body as { body: string }).body.trim().slice(0, 500) : '';

  const { convo } = await membership(id, userId);
  if (!convo.lab_id) throw new HttpError(403, 'TEAM_CHAT_ONLY', 'Images can only be sent in a lab team chat for now.');
  await assertCanSendImage(userId);
  if (caption) await assertClean(userId, [caption], { selfHarm: 'allow' });

  const clean = await cleanImage(req.file.buffer);
  const { public_id } = await uploadPrivateImage(clean.data, 'chat-images');

  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversation_id: id,
        sender_id: userId,
        body: caption,
        created_at: now,
        attachment: { create: { uploader_id: userId, public_id, width: clean.width, height: clean.height } },
      },
      include: { attachment: true },
    }),
    prisma.conversation.update({ where: { id }, data: { updated_at: now } }),
    prisma.conversationMember.update({ where: { conversation_id_user_id: { conversation_id: id, user_id: userId } }, data: { last_read_at: now } }),
  ]);

  // Tell the people who can review it. Teammates hear nothing until it is approved.
  const staff = await prisma.user.findMany({ where: { role: { in: ['moderator', 'admin'] }, id: { not: userId } }, select: { id: true } });
  for (const s of staff) await createNotification(s.id, 'moderation', 'An image is waiting for review', { link: '/admin/attachments' });

  res.status(201).json({
    id: message.id,
    body: message.body,
    created_at: message.created_at,
    from_me: true,
    image: { id: message.attachment!.id, status: message.attachment!.status, width: clean.width, height: clean.height },
  });
};

/** A signed link to one image, for the sender, staff, or a teammate once it is approved. */
export const getImageLink = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const userId = req.userId!;
  const a = await prisma.messageAttachment.findUnique({ where: { id }, include: { message: { select: { conversation_id: true, hidden: true, sender_id: true } } } });
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'Image not found');

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const isStaff = me?.role === 'moderator' || me?.role === 'admin';
  const isSender = a.uploader_id === userId;
  if (!isStaff) {
    const member = await prisma.conversationMember.findUnique({ where: { conversation_id_user_id: { conversation_id: a.message.conversation_id, user_id: userId } } });
    if (!member) throw new HttpError(404, 'NOT_FOUND', 'Image not found');
    const blocked = await blockedEitherWay(userId);
    if (!isSender && blocked.includes(a.uploader_id)) throw new HttpError(404, 'NOT_FOUND', 'Image not found');
    if (!isSender && (a.status !== 'approved' || a.message.hidden)) throw new HttpError(403, 'NOT_APPROVED', 'This image is waiting for a moderator.');
    if (isSender && a.status === 'rejected') throw new HttpError(403, 'REMOVED', 'This image was removed by a moderator.');
  }
  res.json({ url: signedImageUrl(a.public_id), status: a.status });
};
