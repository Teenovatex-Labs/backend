import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { HttpError } from '../lib/errors.js';
import { reportError } from '../lib/monitor.js';

export const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
};

// Every failure leaves the API as { error, code }, never as an HTML stack page.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }

  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res
      .status(tooBig ? 413 : 400)
      .json({ error: tooBig ? 'That file is too large (5 MB max)' : 'Upload failed', code: tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR' });
    return;
  }

  // body-parser attaches a `type` and a status to its own failures.
  const parsed = err as { type?: string; status?: number };
  if (parsed?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large', code: 'PAYLOAD_TOO_LARGE' });
    return;
  }
  if (parsed?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON', code: 'INVALID_JSON' });
    return;
  }

  console.error('Unhandled error:', err);
  reportError(err);
  res.status(500).json({ error: 'Something went wrong on our side', code: 'INTERNAL_ERROR' });
};
