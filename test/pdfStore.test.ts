import { beforeEach, describe, expect, it, vi } from 'vitest';

const aws = vi.hoisted(() => ({ sent: [] as { type: string; input: Record<string, unknown> }[], presigned: [] as { input: Record<string, unknown>; opts: { expiresIn: number } }[] }));
vi.mock('@aws-sdk/client-s3', () => {
  const cmd = (type: string) => class { input: Record<string, unknown>; type = type; constructor(i: Record<string, unknown>) { this.input = i; } };
  return {
    S3Client: class { send = async (c: { type: string; input: Record<string, unknown> }) => { aws.sent.push(c); return {}; }; },
    PutObjectCommand: cmd('put'), GetObjectCommand: cmd('get'), DeleteObjectCommand: cmd('delete'),
  };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: async (_c: unknown, command: { input: Record<string, unknown> }, opts: { expiresIn: number }) => { aws.presigned.push({ input: command.input, opts }); return 'https://signed.example/pdf'; },
}));
const cloud = vi.hoisted(() => ({ uploaded: 0, deleted: [] as string[] }));
vi.mock('../src/middleware/upload.js', async (orig) => ({
  ...(await orig<typeof import('../src/middleware/upload.js')>()),
  uploadPrivatePdf: vi.fn(async () => { cloud.uploaded++; return { public_id: 'applications/cloud-1' }; }),
  signedPdfUrl: vi.fn((id: string) => `https://cloudinary.example/${id}`),
  deletePrivatePdf: vi.fn(async (id: string) => { cloud.deleted.push(id); }),
}));

import { config } from '../src/config.js';
import { LINK_SECONDS, pdfLink, removePdf, s3Enabled, storePdf } from '../src/lib/pdfStore.js';

const off = { endpoint: undefined, region: 'auto', bucket: undefined, accessKeyId: undefined, secretAccessKey: undefined };
const on = { endpoint: 'https://s3.example.com', region: 'auto', bucket: 'tx', accessKeyId: 'k', secretAccessKey: 's' };

beforeEach(() => { aws.sent.length = 0; aws.presigned.length = 0; cloud.uploaded = 0; cloud.deleted.length = 0; config.s3 = { ...off }; });

describe('pdf storage', () => {
  it('stays on Cloudinary until every S3 setting is present', async () => {
    expect(s3Enabled()).toBe(false);
    config.s3 = { ...on, secretAccessKey: undefined };
    expect(s3Enabled()).toBe(false);
    expect(await storePdf(Buffer.from('%PDF-'))).toBe('applications/cloud-1');
    expect(aws.sent).toHaveLength(0);
  });

  it('stores in the bucket with an s3: id and gives 15-minute download-only links', async () => {
    config.s3 = { ...on };
    const id = await storePdf(Buffer.from('%PDF-'));
    expect(id).toMatch(/^s3:applications\/[0-9a-f-]{36}\.pdf$/);
    expect(aws.sent[0]!.type).toBe('put');
    expect(aws.sent[0]!.input).toMatchObject({ Bucket: 'tx', ContentType: 'application/pdf' });
    expect(await pdfLink(id, 'my "report".pdf')).toBe('https://signed.example/pdf');
    expect(aws.presigned[0]!.opts.expiresIn).toBe(LINK_SECONDS);
    expect(LINK_SECONDS).toBe(900);
    expect(aws.presigned[0]!.input.ResponseContentDisposition).toBe('attachment; filename="my _report_.pdf"');
  });

  it('keeps old Cloudinary files working after the switch, and deletes from the right place', async () => {
    config.s3 = { ...on };
    expect(await pdfLink('applications/cloud-1', 'x.pdf')).toBe('https://cloudinary.example/applications/cloud-1');
    await removePdf('applications/cloud-1');
    expect(cloud.deleted).toEqual(['applications/cloud-1']);
    await removePdf('s3:applications/abc.pdf');
    expect(aws.sent[0]).toMatchObject({ type: 'delete', input: { Bucket: 'tx', Key: 'applications/abc.pdf' } });
  });
});
