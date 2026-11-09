import type { Response } from 'express';
import type { Prisma, ApplicationStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { ageOn } from '../lib/age.js';
import { needsGuardian } from '../lib/guardian.js';
import { publicStatus, windowState } from '../lib/admissions.js';
import type { AuthRequest } from '../middleware/auth.js';

// The record of every intake: who applied, what they sent, who decided and how it ended.
// Admin-only (both the window and the review permission), minors' details included, so:
//  - the list shows only what a reviewer needs to find someone (no email, no phone, no answers);
//  - the full submission is opened through the usual application page, which audits every view;
//  - opening a window's list is itself audited;
//  - nothing here keeps data alive: a declined application still disappears on its retention date, and the
//    window shows how many records have been deleted so the gap is explained, not hidden.
// Test windows are left out unless asked for.

const PAGE = 25;
const DECIDED: ApplicationStatus[] = ['accepted', 'declined', 'waitlisted'];

export const listWindowHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  const includeTest = req.query.include_test === '1';
  const windows = await prisma.applicationWindow.findMany({ where: includeTest ? {} : { is_test: false }, orderBy: { opens_at: 'desc' } });
  const ids = windows.map((w) => w.id);
  const [grouped, submitted, released, joined] = await Promise.all([
    prisma.application.groupBy({ by: ['window_id', 'status'], where: { window_id: { in: ids } }, _count: { _all: true } }),
    prisma.application.groupBy({ by: ['window_id'], where: { window_id: { in: ids }, submitted_at: { not: null } }, _count: { _all: true } }),
    prisma.application.groupBy({ by: ['window_id'], where: { window_id: { in: ids }, published_at: { not: null } }, _count: { _all: true } }),
    prisma.invitation.findMany({ where: { used_at: { not: null }, application: { window_id: { in: ids } } }, select: { application: { select: { window_id: true } } } }),
  ]);
  const purged = await Promise.all(ids.map((id) => prisma.auditLog.count({ where: { action: 'application.purge', meta: { path: ['window_id'], equals: id } } })));

  const items = windows.map((w, i) => {
    const by: Record<string, number> = {};
    for (const g of grouped) if (g.window_id === w.id) by[g.status] = g._count._all;
    const n = (s: ApplicationStatus) => by[s] ?? 0;
    return {
      id: w.id,
      is_test: w.is_test,
      note: w.note,
      opens_at: w.opens_at.toISOString(),
      closes_at: w.closes_at.toISOString(),
      decisions_publish_at: w.decisions_publish_at.toISOString(),
      state: windowState(w),
      released: w.status === 'published',
      target_size: w.target_size,
      by_status: by,
      started: Object.values(by).reduce((a, b) => a + b, 0),
      submitted: submitted.find((s) => s.window_id === w.id)?._count._all ?? 0,
      drafts: n('draft'),
      accepted: n('accepted'),
      declined: n('declined'),
      waitlisted: n('waitlisted'),
      withdrawn: n('withdrawn'),
      undecided: n('submitted') + n('under_review') + n('shortlisted'),
      results_released: released.find((r) => r.window_id === w.id)?._count._all ?? 0,
      joined: joined.filter((j) => j.application?.window_id === w.id).length,
      // Records already removed under the retention rules (counted from when this record was introduced).
      deleted: purged[i] ?? 0,
    };
  });
  res.json({ items, include_test: includeTest });
};

export const windowApplicants = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const w = await prisma.applicationWindow.findUnique({ where: { id } });
  if (!w) throw new HttpError(404, 'NOT_FOUND', 'Window not found');
  const q = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(q.page) || 1);
  const status = q.status as ApplicationStatus | undefined;
  const search = q.q?.trim();
  const where: Prisma.ApplicationWhereInput = {
    window_id: id,
    // Drafts are people who started and never submitted. They are counted, listed only when asked for.
    status: status ?? { not: 'draft' },
    ...(search && { OR: [{ full_name: { contains: search, mode: 'insensitive' } }, { reference: { contains: search, mode: 'insensitive' } }, { country: { contains: search, mode: 'insensitive' } }] }),
  };
  const [rows, total, drafts] = await Promise.all([
    prisma.application.findMany({
      where,
      orderBy: [{ submitted_at: 'asc' }, { created_at: 'asc' }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        reviews: { where: { submitted_at: { not: null } }, select: { weighted_score: true, recommendation: true } },
        consent: { select: { status: true } },
        invitations: { select: { used_at: true } },
        _count: { select: { answers: true, attachments: true } },
      },
    }),
    prisma.application.count({ where }),
    prisma.application.count({ where: { window_id: id, status: 'draft' } }),
  ]);

  const people = [...new Set(rows.flatMap((r) => [r.claimed_by, r.decided_by]).filter((x): x is string => !!x))];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: people } }, select: { id: true, full_name: true } })).map((u) => [u.id, u.full_name]));

  await audit(req.userId!, 'application.history_view', { type: 'application_window', id }, { page, ...(status && { status }), ...(search && { searched: true }) });

  res.json({
    window: { id: w.id, is_test: w.is_test, note: w.note, opens_at: w.opens_at.toISOString(), closes_at: w.closes_at.toISOString(), decisions_publish_at: w.decisions_publish_at.toISOString(), state: windowState(w), released: w.status === 'published' },
    drafts,
    items: rows.map((a) => {
      const scores = a.reviews.map((r) => r.weighted_score).filter((x): x is number => x !== null);
      const waitlistOffer = a.waitlist_offer_sent_at ? (a.waitlist_offer_response ?? (a.waitlist_offer_expires_at && a.waitlist_offer_expires_at < new Date() ? 'expired' : 'pending')) : null;
      return {
        id: a.id,
        reference: a.reference,
        full_name: a.full_name,
        age: ageOn(a.birth_date),
        country: a.country,
        status: a.status,
        // What the applicant has been told, so the team can see the gap between a decision and its release.
        outcome_released: DECIDED.includes(a.status) ? a.published_at !== null : null,
        applicant_sees: publicStatus(a, w),
        started_at: a.created_at.toISOString(),
        submitted_at: a.submitted_at?.toISOString() ?? null,
        decided_at: a.decided_at?.toISOString() ?? null,
        reviewer: a.claimed_by ? names.get(a.claimed_by) ?? null : null,
        decided_by: a.decided_by ? names.get(a.decided_by) ?? null : null,
        reviews: a.reviews.length,
        average_score: scores.length ? Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 10) / 10 : null,
        questions: a._count.answers,
        files: a._count.attachments,
        interview_invited: a.interview_invited_at !== null,
        waitlist_offer: waitlistOffer,
        guardian: a.status === 'accepted' && needsGuardian(a.birth_date) ? a.consent?.status ?? 'not_requested' : null,
        joined: a.invitations.some((i) => i.used_at !== null),
        // When a declined application will be deleted, so the team can see what is still held.
        delete_on: a.retention_delete_at?.toISOString() ?? null,
      };
    }),
    total,
    page,
    pages: Math.ceil(total / PAGE),
  });
};
