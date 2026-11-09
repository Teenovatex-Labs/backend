import crypto from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';
import { deletePrivatePdf, signedPdfUrl, uploadPrivatePdf } from '../middleware/upload.js';

/**
 * Where private application PDFs live. With the S3 settings present they go to the S3-compatible bucket (Neon storage)
 * and are handed out as 15-minute download links. Without them everything behaves as before, on Cloudinary. The stored
 * id says which one holds the file (`s3:` prefix), so old and new files keep working side by side.
 */
const PREFIX = 's3:';
export const LINK_SECONDS = 15 * 60;

export const s3Enabled = () => {
  const c = config.s3;
  return Boolean(c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey);
};

let client: S3Client | null = null;
const s3 = () => {
  const c = config.s3;
  client ??= new S3Client({ endpoint: c.endpoint, region: c.region, forcePathStyle: true, credentials: { accessKeyId: c.accessKeyId!, secretAccessKey: c.secretAccessKey! } });
  return client;
};

export const storePdf = async (buffer: Buffer): Promise<string> => {
  if (!s3Enabled()) return (await uploadPrivatePdf(buffer, 'applications')).public_id;
  const key = `applications/${crypto.randomUUID()}.pdf`;
  await s3().send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: buffer, ContentType: 'application/pdf' }));
  return PREFIX + key;
};

/** A short-lived link that downloads the file instead of showing it in the browser. */
export const pdfLink = async (id: string, filename: string | null): Promise<string> => {
  if (!id.startsWith(PREFIX)) return signedPdfUrl(id);
  const safe = (filename ?? 'document.pdf').replace(/[^\w.\- ]/g, '_').slice(0, 80);
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: config.s3.bucket, Key: id.slice(PREFIX.length), ResponseContentDisposition: `attachment; filename="${safe}"`, ResponseContentType: 'application/pdf' }), { expiresIn: LINK_SECONDS });
};

export const removePdf = async (id: string): Promise<void> => {
  if (!id.startsWith(PREFIX)) return deletePrivatePdf(id);
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: id.slice(PREFIX.length) }));
  } catch {
    // a missing file is not worth failing a delete over
  }
};
