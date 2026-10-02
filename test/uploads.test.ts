import { describe, expect, it } from 'vitest';
import { uploadPrivateImage, uploadToCloudinary } from '../src/middleware/upload.js';

describe('image storage that is not set up', () => {
  it('fails with a clear 503 instead of a confusing cloud error', async () => {
    await expect(uploadToCloudinary(Buffer.from('x'), 'avatars')).rejects.toMatchObject({ status: 503, code: 'UPLOADS_NOT_CONFIGURED' });
    await expect(uploadPrivateImage(Buffer.from('x'), 'chat-images')).rejects.toMatchObject({ status: 503, code: 'UPLOADS_NOT_CONFIGURED' });
  });
});
