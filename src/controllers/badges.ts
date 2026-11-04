import type { Request, Response } from 'express';
import sharp from 'sharp';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import { createNotification } from '../lib/notify.js';
import { SvgRejected, sanitizeSvg } from '../lib/svgSanitize.js';
import type { AuthRequest } from '../middleware/auth.js';
import { uploadToCloudinary } from '../middleware/upload.js';

const RASTER_MAX_BYTES = 1024 * 1024;
const RASTER_MAX_PX = 1024;

const shape = (b: { id: string; slug: string; name: string; description: string; tier: string; criteria_text: string; image_kind: string | null; image_url: string | null; fallback_url: string | null; active: boolean; repeatable: boolean }) => ({
  id: b.id, slug: b.slug, name: b.name, description: b.description, tier: b.tier, criteria_text: b.criteria_text,
  image_kind: b.image_kind, image_url: b.image_url, fallback_url: b.fallback_url, active: b.active, repeatable: b.repeatable,
});

export const listBadges = async (_req: AuthRequest, res: Response): Promise<void> => {
  const items = await prisma.badgeDefinition.findMany({ orderBy: { created_at: 'asc' }, include: { _count: { select: { awards: { where: { revoked_at: null } } } } } });
  res.json({ items: items.map((b) => ({ ...shape(b), awards: b._count.awards })) });
};

export const createBadge = async (req: AuthRequest, res: Response): Promise<void> => {
  const b = req.body as { slug: string; name: string; description: string; tier?: 'standard' | 'high' | 'top'; criteria_text: string; repeatable?: boolean };
  if (await prisma.badgeDefinition.findUnique({ where: { slug: b.slug } })) throw new HttpError(409, 'SLUG_TAKEN', 'A badge with that slug already exists.');
  const created = await prisma.badgeDefinition.create({ data: { ...b, created_by: req.userId } });
  await audit(req.userId!, 'badge.create', { type: 'badge', id: created.id });
  res.status(201).json(shape(created));
};

export const updateBadge = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  if (!(await prisma.badgeDefinition.findUnique({ where: { id } }))) throw new HttpError(404, 'NOT_FOUND', 'Badge not found');
  const updated = await prisma.badgeDefinition.update({ where: { id }, data: req.body as object });
  await audit(req.userId!, 'badge.update', { type: 'badge', id }, req.body as object);
  res.json(shape(updated));
};

/** Re-encodes raster art (which strips hidden metadata and anything that is not really an image) or sanitises SVG. */
export const uploadBadgeImage = async (req: AuthRequest & { file?: Express.Multer.File }, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const badge = await prisma.badgeDefinition.findUnique({ where: { id } });
  if (!badge) throw new HttpError(404, 'NOT_FOUND', 'Badge not found');
  if (!req.file) throw new HttpError(400, 'NO_FILE', 'Choose an image to upload.');
  const { buffer, mimetype } = req.file;

  if (mimetype === 'image/svg+xml') {
    let svg: string;
    try {
      svg = sanitizeSvg(buffer.toString('utf8'));
    } catch (err) {
      if (err instanceof SvgRejected) throw new HttpError(422, 'BAD_SVG', err.message);
      throw err;
    }
    let fallback_url: string | null = null;
    try {
      fallback_url = await uploadToCloudinary(await sharp(Buffer.from(svg)).resize(256, 256, { fit: 'inside' }).png().toBuffer(), 'badges');
    } catch (err) {
      console.error('Badge PNG fallback not stored:', err);
    }
    const updated = await prisma.badgeDefinition.update({ where: { id }, data: { image_kind: 'svg', svg_source: svg, image_url: `/api/v1/badges/${badge.slug}/image.svg`, fallback_url } });
    await audit(req.userId!, 'badge.update', { type: 'badge', id }, { image: 'svg' });
    res.json(shape(updated));
    return;
  }

  if (mimetype !== 'image/png' && mimetype !== 'image/webp') throw new HttpError(400, 'INVALID_FILE_TYPE', 'Badge art must be SVG, PNG or WebP.');
  if (buffer.length > RASTER_MAX_BYTES) throw new HttpError(422, 'TOO_LARGE', 'PNG and WebP files must be under 1 MB.');
  const kind = mimetype === 'image/png' ? 'png' : 'webp';
  let encoded: Buffer;
  try {
    const img = sharp(buffer).resize(RASTER_MAX_PX, RASTER_MAX_PX, { fit: 'inside', withoutEnlargement: true });
    encoded = await (kind === 'png' ? img.png() : img.webp()).toBuffer();
  } catch {
    throw new HttpError(422, 'BAD_IMAGE', 'That file is not a valid image.');
  }
  const url = await uploadToCloudinary(encoded, 'badges');
  const updated = await prisma.badgeDefinition.update({ where: { id }, data: { image_kind: kind, image_url: url, fallback_url: url, svg_source: null } });
  await audit(req.userId!, 'badge.update', { type: 'badge', id }, { image: kind });
  res.json(shape(updated));
};

/** Public: serves the sanitised SVG ourselves, locked down so it can only ever be drawn, never run. */
export const serveBadgeSvg = async (req: Request, res: Response): Promise<void> => {
  const badge = await prisma.badgeDefinition.findUnique({ where: { slug: String(req.params.slug) }, select: { svg_source: true } });
  if (!badge?.svg_source) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
  res.set({
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    // The app and the API live on different hosts, so the default same-origin policy would stop <img> loading it.
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': 'public, max-age=3600',
  });
  res.send(badge.svg_source);
};

export const awardBadge = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { user_id, reason, challenge_id } = req.body as { user_id: string; reason: string; challenge_id?: string };
  const badge = await prisma.badgeDefinition.findUnique({ where: { id } });
  if (!badge) throw new HttpError(404, 'NOT_FOUND', 'Badge not found');
  if (!badge.active) throw new HttpError(409, 'INACTIVE', 'This badge is switched off.');
  if (user_id === req.userId) throw new HttpError(403, 'SELF_AWARD', 'Nobody can award themselves a badge.');
  if (!(await prisma.user.findUnique({ where: { id: user_id }, select: { id: true } }))) throw new HttpError(404, 'NOT_FOUND', 'Member not found');
  if (!badge.repeatable && (await prisma.badgeAward.findFirst({ where: { user_id, badge_id: id, revoked_at: null } }))) {
    throw new HttpError(409, 'ALREADY_AWARDED', 'This member already has this badge.');
  }
  const award = await prisma.badgeAward.create({ data: { user_id, badge_id: id, awarded_by: req.userId!, reason, challenge_id: challenge_id ?? null } });
  await audit(req.userId!, 'badge.award', { type: 'badge_award', id: award.id }, { badge: badge.slug, user_id });
  await createNotification(user_id, 'badge', `You received the ${badge.name} badge`, { link: '/profile', payload: { badge_slug: badge.slug } });
  res.status(201).json({ id: award.id, badge: shape(badge), awarded_at: award.awarded_at.toISOString() });
};

export const revokeAward = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const { reason } = req.body as { reason: string };
  const award = await prisma.badgeAward.findUnique({ where: { id } });
  if (!award) throw new HttpError(404, 'NOT_FOUND', 'Award not found');
  if (award.revoked_at) throw new HttpError(409, 'ALREADY_REVOKED', 'This award was already revoked.');
  await prisma.badgeAward.update({ where: { id }, data: { revoked_at: new Date(), revoked_by: req.userId, revoke_reason: reason, featured: false } });
  await audit(req.userId!, 'badge.revoke', { type: 'badge_award', id }, { reason });
  res.json({ revoked: true });
};

/** A member chooses up to three of their own current honours to show first. */
export const setFeatured = async (req: AuthRequest, res: Response): Promise<void> => {
  const { award_ids } = req.body as { award_ids: string[] };
  const ids = [...new Set(award_ids)];
  const mine = await prisma.badgeAward.findMany({ where: { id: { in: ids }, user_id: req.userId, revoked_at: null }, select: { id: true } });
  if (mine.length !== ids.length) throw new HttpError(400, 'NOT_YOURS', 'You can only feature badges you currently hold.');
  await prisma.$transaction([
    prisma.badgeAward.updateMany({ where: { user_id: req.userId }, data: { featured: false } }),
    prisma.badgeAward.updateMany({ where: { id: { in: ids }, user_id: req.userId }, data: { featured: true } }),
  ]);
  res.json({ featured: ids });
};

/** Current honours for a profile: featured first, then newest. Revoked ones never appear. */
export const honorsFor = async (userId: string) =>
  (await prisma.badgeAward.findMany({ where: { user_id: userId, revoked_at: null, badge: { active: true } }, include: { badge: true }, orderBy: [{ featured: 'desc' }, { awarded_at: 'desc' }] })).map((a) => ({
    id: a.id, slug: a.badge.slug, name: a.badge.name, description: a.badge.description, criteria_text: a.badge.criteria_text, tier: a.badge.tier,
    image_url: a.badge.image_url, fallback_url: a.badge.fallback_url, awarded_at: a.awarded_at.toISOString(), featured: a.featured,
  }));
