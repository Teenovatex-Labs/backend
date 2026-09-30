import type { Response } from 'express';
import type { Prisma, TaskStatus } from '@prisma/client';
import type { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { assertClean } from '../lib/guard.js';
import { createNotification } from '../lib/notify.js';
import { checkBadgesQuietly } from '../lib/badges.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const author = { select: { username: true, avatar_url: true } } as const;

type Lab = { id: string; slug: string; name: string; user_id: string };

const loadLab = async (idOrSlug: string): Promise<Lab> => {
  const lab = await prisma.project.findUnique({
    where: UUID.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug },
    select: { id: true, slug: true, name: true, user_id: true },
  });
  if (!lab) throw new HttpError(404, 'NOT_FOUND', 'Lab not found');
  return lab;
};

/** 'owner', 'member', or null for anyone outside the team. */
export const roleIn = async (labId: string, userId: string | undefined) => {
  if (!userId) return null;
  const m = await prisma.labMember.findUnique({ where: { lab_id_user_id: { lab_id: labId, user_id: userId } } });
  return m?.role ?? null;
};

const requireTeam = async (lab: Lab, userId: string | undefined) => {
  const role = await roleIn(lab.id, userId);
  if (!role) throw new HttpError(403, 'NOT_ON_TEAM', 'Only the lab team can do that');
  return role;
};
const requireOwner = async (lab: Lab, userId: string | undefined) => {
  if ((await roleIn(lab.id, userId)) !== 'owner') throw new HttpError(403, 'NOT_OWNER', 'Only the lab owner can do that');
};

const teamIds = async (labId: string) => (await prisma.labMember.findMany({ where: { lab_id: labId }, select: { user_id: true } })).map((m) => m.user_id);

const resolveAssignee = async (labId: string, username: string | null | undefined) => {
  if (username === undefined) return undefined;
  if (username === null) return null;
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user || !(await roleIn(labId, user.id))) throw new HttpError(400, 'INVALID_ASSIGNEE', 'You can only assign a task to someone on the team');
  return user.id;
};

// --- build log -----------------------------------------------------------------------------

export const listUpdates = async (req: AuthRequest, res: Response): Promise<void> => {
  const lab = await loadLab((req.params as { id: string }).id);
  const page = Math.max(1, parseInt(String(req.query.page ?? '1')) || 1);
  const [rows, total] = await Promise.all([
    prisma.labUpdate.findMany({ where: { lab_id: lab.id }, orderBy: { created_at: 'desc' }, skip: (page - 1) * 10, take: 10 }),
    prisma.labUpdate.count({ where: { lab_id: lab.id } }),
  ]);
  const people = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.author_id) } }, select: { id: true, username: true, avatar_url: true } });
  const byId = new Map(people.map((p) => [p.id, p]));
  res.json({
    updates: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, created_at: r.created_at, author: byId.get(r.author_id) ? { username: byId.get(r.author_id)!.username, avatar_url: byId.get(r.author_id)!.avatar_url } : null })),
    total,
    page,
    pages: Math.ceil(total / 10),
  });
};

export const createUpdate = async (req: AuthRequest, res: Response): Promise<void> => {
  const lab = await loadLab((req.params as { id: string }).id);
  await requireTeam(lab, req.userId);
  const { title, body } = req.body as { title: string; body: string };
  await assertClean(req.userId!, [title, body]);
  const update = await prisma.labUpdate.create({ data: { lab_id: lab.id, author_id: req.userId!, title, body } });
  checkBadgesQuietly(req.userId);
  res.status(201).json(update);
};

export const deleteUpdate = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, uid } = req.params as { id: string; uid: string };
  const lab = await loadLab(id);
  const update = await prisma.labUpdate.findFirst({ where: { id: uid, lab_id: lab.id } });
  if (!update) throw new HttpError(404, 'NOT_FOUND', 'Update not found');
  if (update.author_id !== req.userId && (await roleIn(lab.id, req.userId)) !== 'owner') throw new HttpError(403, 'FORBIDDEN', 'Only the author or the lab owner can delete this');
  await prisma.labUpdate.delete({ where: { id: uid } });
  res.json({ message: 'Update deleted' });
};

// --- board ---------------------------------------------------------------------------------

const shapeTask = (t: { id: string; title: string; notes: string | null; status: TaskStatus; position: number; assignee_id: string | null; due_at: Date | null; created_at: Date; done_at: Date | null }, names: Map<string, string>) => ({
  id: t.id,
  title: t.title,
  notes: t.notes,
  status: t.status,
  position: t.position,
  assignee: t.assignee_id ? names.get(t.assignee_id) ?? null : null,
  due_at: t.due_at,
  created_at: t.created_at,
  done_at: t.done_at,
});

export const getBoard = async (req: AuthRequest, res: Response): Promise<void> => {
  const lab = await loadLab((req.params as { id: string }).id);
  await requireTeam(lab, req.userId);
  const tasks = await prisma.labTask.findMany({ where: { lab_id: lab.id }, orderBy: [{ status: 'asc' }, { position: 'asc' }, { created_at: 'asc' }] });
  const ids = [...new Set(tasks.map((t) => t.assignee_id).filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } });
  const names = new Map(users.map((u) => [u.id, u.username]));
  const columns: Record<TaskStatus, ReturnType<typeof shapeTask>[]> = { backlog: [], in_progress: [], testing: [], done: [] };
  for (const t of tasks) columns[t.status].push(shapeTask(t, names));
  res.json({ columns });
};

export const createTask = async (req: AuthRequest, res: Response): Promise<void> => {
  const lab = await loadLab((req.params as { id: string }).id);
  await requireTeam(lab, req.userId);
  const b = req.body as { title: string; notes?: string; status?: TaskStatus; due_at?: string | null; assignee?: string | null };
  await assertClean(req.userId!, [b.title, b.notes]);
  const status = b.status ?? 'backlog';
  const assignee_id = await resolveAssignee(lab.id, b.assignee);
  const top = await prisma.labTask.aggregate({ where: { lab_id: lab.id, status }, _max: { position: true } });
  const task = await prisma.labTask.create({
    data: {
      lab_id: lab.id,
      title: b.title,
      notes: b.notes ?? null,
      status,
      position: (top._max.position ?? -1) + 1,
      assignee_id: assignee_id ?? null,
      due_at: b.due_at ? new Date(b.due_at) : null,
      created_by: req.userId!,
      done_at: status === 'done' ? new Date() : null,
    },
  });
  res.status(201).json(shapeTask(task, new Map()));
};

export const updateTask = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, tid } = req.params as { id: string; tid: string };
  const lab = await loadLab(id);
  await requireTeam(lab, req.userId);
  const b = req.body as { title?: string; notes?: string | null; status?: TaskStatus; position?: number; due_at?: string | null; assignee?: string | null };
  const task = await prisma.labTask.findFirst({ where: { id: tid, lab_id: lab.id } });
  if (!task) throw new HttpError(404, 'NOT_FOUND', 'Task not found');
  await assertClean(req.userId!, [b.title, b.notes]);
  const assignee_id = await resolveAssignee(lab.id, b.assignee);

  await prisma.$transaction(async (tx) => {
    const moving = b.status !== undefined && (b.status !== task.status || b.position !== undefined);
    if (moving) {
      const to = b.status ?? task.status;
      // Re-pack the destination column so positions stay 0..n-1 and the card lands where it was dropped.
      const column = await tx.labTask.findMany({ where: { lab_id: lab.id, status: to, id: { not: tid } }, orderBy: { position: 'asc' }, select: { id: true } });
      const at = Math.min(b.position ?? column.length, column.length);
      column.splice(at, 0, { id: tid });
      await Promise.all(column.map((c, i) => tx.labTask.update({ where: { id: c.id }, data: { position: i } })));
    }
    const data: Prisma.LabTaskUncheckedUpdateInput = {
      ...(b.title !== undefined && { title: b.title }),
      ...(b.notes !== undefined && { notes: b.notes }),
      ...(b.status !== undefined && { status: b.status, done_at: b.status === 'done' ? task.done_at ?? new Date() : null }),
      ...(b.due_at !== undefined && { due_at: b.due_at ? new Date(b.due_at) : null, reminded_at: null }),
      ...(assignee_id !== undefined && { assignee_id }),
    };
    await tx.labTask.update({ where: { id: tid }, data });
  });

  const fresh = await prisma.labTask.findUniqueOrThrow({ where: { id: tid } });
  const who = fresh.assignee_id ? await prisma.user.findUnique({ where: { id: fresh.assignee_id }, select: { id: true, username: true } }) : null;
  // Tell someone when a task lands on them (but not when they gave it to themselves).
  if (assignee_id && assignee_id !== task.assignee_id && assignee_id !== req.userId) {
    await createNotification(assignee_id, 'task', `You were assigned "${fresh.title}" in ${lab.name}`, { link: `/labs/${lab.slug}?tab=board` });
  }
  res.json(shapeTask(fresh, new Map(who ? [[who.id, who.username]] : [])));
};

export const deleteTask = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, tid } = req.params as { id: string; tid: string };
  const lab = await loadLab(id);
  await requireTeam(lab, req.userId);
  const { count } = await prisma.labTask.deleteMany({ where: { id: tid, lab_id: lab.id } });
  if (count === 0) throw new HttpError(404, 'NOT_FOUND', 'Task not found');
  res.json({ message: 'Task deleted' });
};

/** Everything assigned to me (or unassigned in my labs) that is still open, soonest deadline first. */
export const myTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  const memberships = await prisma.labMember.findMany({ where: { user_id: req.userId }, select: { lab_id: true } });
  const tasks = await prisma.labTask.findMany({
    where: { lab_id: { in: memberships.map((m) => m.lab_id) }, status: { not: 'done' }, OR: [{ assignee_id: req.userId }, { assignee_id: null }] },
    orderBy: [{ due_at: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }],
    take: 20,
    include: { lab: { select: { name: true, slug: true } } },
  });
  res.json({ tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, due_at: t.due_at, assigned_to_me: t.assignee_id === req.userId, lab: t.lab })) });
};

// --- milestones ----------------------------------------------------------------------------

export const listMilestones = async (req: AuthRequest, res: Response): Promise<void> => {
  const lab = await loadLab((req.params as { id: string }).id);
  const milestones = await prisma.labMilestone.findMany({ where: { lab_id: lab.id }, orderBy: [{ due_at: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }] });
  res.json({ milestones: milestones.map((m) => ({ id: m.id, title: m.title, due_at: m.due_at, done: m.done_at !== null, done_at: m.done_at })) });
};

export const createMilestone = async (req: AuthRequest, res: Response): Promise<void> => {
  const lab = await loadLab((req.params as { id: string }).id);
  await requireTeam(lab, req.userId);
  const { title, due_at } = req.body as { title: string; due_at?: string | null };
  await assertClean(req.userId!, [title]);
  if ((await prisma.labMilestone.count({ where: { lab_id: lab.id } })) >= 30) throw new HttpError(400, 'LIMIT', 'That is plenty of milestones. Finish a few first.');
  const m = await prisma.labMilestone.create({ data: { lab_id: lab.id, title, due_at: due_at ? new Date(due_at) : null } });
  res.status(201).json({ id: m.id, title: m.title, due_at: m.due_at, done: false, done_at: null });
};

export const updateMilestone = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, mid } = req.params as { id: string; mid: string };
  const lab = await loadLab(id);
  await requireTeam(lab, req.userId);
  const b = req.body as { title?: string; due_at?: string | null; done?: boolean };
  const existing = await prisma.labMilestone.findFirst({ where: { id: mid, lab_id: lab.id } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Milestone not found');
  await assertClean(req.userId!, [b.title]);
  const m = await prisma.labMilestone.update({
    where: { id: mid },
    data: {
      ...(b.title !== undefined && { title: b.title }),
      ...(b.due_at !== undefined && { due_at: b.due_at ? new Date(b.due_at) : null, reminded_at: null }),
      ...(b.done !== undefined && { done_at: b.done ? existing.done_at ?? new Date() : null }),
    },
  });
  // A finished milestone is worth celebrating with the team.
  if (b.done && !existing.done_at) {
    for (const uid of await teamIds(lab.id)) checkBadgesQuietly(uid);
    for (const uid of (await teamIds(lab.id)).filter((u) => u !== req.userId)) {
      await createNotification(uid, 'milestone', `Milestone reached in ${lab.name}: ${m.title}`, { link: `/labs/${lab.slug}` });
    }
  }
  res.json({ id: m.id, title: m.title, due_at: m.due_at, done: m.done_at !== null, done_at: m.done_at });
};

export const deleteMilestone = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, mid } = req.params as { id: string; mid: string };
  const lab = await loadLab(id);
  await requireTeam(lab, req.userId);
  const { count } = await prisma.labMilestone.deleteMany({ where: { id: mid, lab_id: lab.id } });
  if (count === 0) throw new HttpError(404, 'NOT_FOUND', 'Milestone not found');
  res.json({ message: 'Milestone deleted' });
};

// --- team ----------------------------------------------------------------------------------

export const getTeam = async (req: AuthRequest, res: Response): Promise<void> => {
  const lab = await loadLab((req.params as { id: string }).id);
  const members = await prisma.labMember.findMany({ where: { lab_id: lab.id }, orderBy: [{ role: 'asc' }, { created_at: 'asc' }], include: { user: author } });
  const me = await roleIn(lab.id, req.userId);
  const mine = req.userId ? await prisma.labJoinRequest.findUnique({ where: { lab_id_user_id: { lab_id: lab.id, user_id: req.userId } } }) : null;
  const pending = me === 'owner'
    ? await prisma.labJoinRequest.findMany({ where: { lab_id: lab.id, status: 'pending' }, orderBy: { created_at: 'asc' }, include: { user: author } })
    : [];
  res.json({
    members: members.map((m) => ({ username: m.user.username, avatar_url: m.user.avatar_url, role: m.role })),
    my_role: me,
    my_request: mine ? { status: mine.status } : null,
    requests: pending.map((r) => ({ id: r.id, message: r.message, created_at: r.created_at, user: r.user })),
  });
};

export const requestToJoin = async (req: AuthRequest, res: Response): Promise<void> => {
  const lab = await loadLab((req.params as { id: string }).id);
  const { message } = req.body as { message?: string };
  if (await roleIn(lab.id, req.userId)) throw new HttpError(400, 'ALREADY_MEMBER', "You're already on this team");
  const blocked = await prisma.block.count({ where: { OR: [{ blocker_id: lab.user_id, blocked_id: req.userId }, { blocker_id: req.userId, blocked_id: lab.user_id }] } });
  if (blocked) throw new HttpError(403, 'FORBIDDEN', "You can't ask to join this lab");
  await assertClean(req.userId!, [message]);

  const existing = await prisma.labJoinRequest.findUnique({ where: { lab_id_user_id: { lab_id: lab.id, user_id: req.userId! } } });
  if (existing?.status === 'pending') throw new HttpError(409, 'ALREADY_REQUESTED', 'You already asked to join. The owner will get back to you.');
  if (existing?.status === 'declined') throw new HttpError(403, 'DECLINED', "The owner said not right now. You can't ask again for this lab.");

  await prisma.labJoinRequest.create({ data: { lab_id: lab.id, user_id: req.userId!, message: message || null } });
  const me = await prisma.user.findUnique({ where: { id: req.userId }, select: { username: true } });
  await createNotification(lab.user_id, 'join_request', `@${me?.username} wants to join ${lab.name}`, { link: `/labs/${lab.slug}?tab=team` });
  res.status(201).json({ message: 'Asked! The owner will see your request.' });
};

export const answerRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, rid } = req.params as { id: string; rid: string };
  const accept = req.path.endsWith('/accept');
  const lab = await loadLab(id);
  await requireOwner(lab, req.userId);
  const request = await prisma.labJoinRequest.findFirst({ where: { id: rid, lab_id: lab.id, status: 'pending' } });
  if (!request) throw new HttpError(404, 'NOT_FOUND', 'Request not found');

  await prisma.$transaction(async (tx) => {
    await tx.labJoinRequest.update({ where: { id: rid }, data: { status: accept ? 'accepted' : 'declined' } });
    if (accept) await tx.labMember.upsert({ where: { lab_id_user_id: { lab_id: lab.id, user_id: request.user_id } }, create: { lab_id: lab.id, user_id: request.user_id }, update: {} });
  });
  if (accept) checkBadgesQuietly(request.user_id);
  await createNotification(request.user_id, 'join_request', accept ? `You're on the team for ${lab.name}!` : `${lab.name} isn't taking new people right now.`, { link: `/labs/${lab.slug}` });
  res.json({ message: accept ? 'Added to the team' : 'Declined' });
};

export const removeMember = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, username } = req.params as { id: string; username: string };
  const lab = await loadLab(id);
  const target = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!target) throw new HttpError(404, 'NOT_FOUND', 'Member not found');
  if (target.id === lab.user_id) throw new HttpError(400, 'OWNER', "The owner can't leave their own lab. Delete it instead.");
  const isSelf = target.id === req.userId;
  if (!isSelf) await requireOwner(lab, req.userId);
  const { count } = await prisma.labMember.deleteMany({ where: { lab_id: lab.id, user_id: target.id } });
  if (count === 0) throw new HttpError(404, 'NOT_FOUND', 'They are not on this team');
  // Their open tasks go back to the pool rather than staying assigned to someone who left.
  await prisma.labTask.updateMany({ where: { lab_id: lab.id, assignee_id: target.id }, data: { assignee_id: null } });
  // Leaving can reopen the door: a fresh request is allowed later.
  await prisma.labJoinRequest.deleteMany({ where: { lab_id: lab.id, user_id: target.id } });
  res.json({ message: isSelf ? 'You left the team' : 'Removed from the team' });
};
