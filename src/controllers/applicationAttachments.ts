import type { Response } from 'express';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { cleanImage } from '../lib/attachments.js';
import { HttpError } from '../lib/errors.js';
import { deletePrivateImage, signedImageUrl, uploadPrivateImage } from '../middleware/upload.js';
import type { ApplicantRequest } from '../middleware/applicant.js';
import type { AuthRequest } from '../middleware/auth.js';

export const MAX_IMAGES = 3;
export const MAX_LINKS = 3;

const editable = (a: { status: string; locked_at: Date | null }) => a.status === 'draft' || (a.status === 'submitted' && !a.locked_at);
const shape = (a: { id: string; kind: string; url: string | null; filename: string | null; size_bytes: number | null }) => ({ id: a.id, kind: a.kind, url: a.url, filename: a.filename, size_bytes: a.size_bytes });

const guard = async (req: ApplicantRequest) => {
  const app = req.application!;
  if (!editable(app)) throw new HttpError(409, 'APPLICATION_LOCKED', 'This application is being reviewed and can no longer be edited.');
  return app;
};

export const listMine = async (req: ApplicantRequest, res: Response): Promise<void> => {
  const items = await prisma.applicationAttachment.findMany({ where: { application_id: req.application!.id }, orderBy: { created_at: 'asc' } });
  res.json({ items: items.map(shape), limits: { images: MAX_IMAGES, links: MAX_LINKS } });
};

/**
 * One project screenshot or photo. It is decoded as a real image, resized and re-encoded (which drops GPS and
 * camera data) and stored privately; only reviewers can open it, through a short-lived signed link.
 */
export const uploadImage = async (req: ApplicantRequest & { file?: Express.Multer.File }, res: Response): Promise<void> => {
  const app = await guard(req);
  if (!req.file) throw new HttpError(400, 'NO_FILE', 'Choose an image to add.');
  if ((await prisma.applicationAttachment.count({ where: { application_id: app.id, kind: 'image' } })) >= MAX_IMAGES) {
    throw new HttpError(409, 'ATTACHMENT_LIMIT', `You can add up to ${MAX_IMAGES} images.`);
  }
  const clean = await cleanImage(req.file.buffer);
  const { public_id } = await uploadPrivateImage(clean.data, 'applications');
  const row = await prisma.applicationAttachment.create({
    data: { application_id: app.id, kind: 'image', public_id, filename: (req.file.originalname || 'image').slice(0, 80), mime_type: 'image/webp', size_bytes: clean.data.length, scan_status: 'clean' },
  });
  res.status(201).json(shape(row));
};

export const addLink = async (req: ApplicantRequest, res: Response): Promise<void> => {
  const app = await guard(req);
  if ((await prisma.applicationAttachment.count({ where: { application_id: app.id, kind: 'link' } })) >= MAX_LINKS) {
    throw new HttpError(409, 'ATTACHMENT_LIMIT', `You can add up to ${MAX_LINKS} links.`);
  }
  const { url } = req.body as { url: string };
  const row = await prisma.applicationAttachment.create({ data: { application_id: app.id, kind: 'link', url, filename: new URL(url).hostname, scan_status: 'clean' } });
  res.status(201).json(shape(row));
};

export const removeAttachment = async (req: ApplicantRequest, res: Response): Promise<void> => {
  const app = await guard(req);
  const a = await prisma.applicationAttachment.findFirst({ where: { id: String(req.params.id), application_id: app.id } });
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'Attachment not found');
  await prisma.applicationAttachment.delete({ where: { id: a.id } });
  if (a.public_id) await deletePrivateImage(a.public_id);
  res.json({ ok: true });
};

/** A reviewer opens an image. Short-lived signed link, and every open is audited. */
export const reviewerLink = async (req: AuthRequest, res: Response): Promise<void> => {
  const a = await prisma.applicationAttachment.findFirst({ where: { id: String(req.params.attId), application_id: String(req.params.id), kind: 'image' } });
  if (!a?.public_id) throw new HttpError(404, 'NOT_FOUND', 'Attachment not found');
  await audit(req.userId!, 'application.attachment_view', { type: 'application', id: a.application_id }, { attachment: a.id });
  res.json({ url: signedImageUrl(a.public_id) });
};
