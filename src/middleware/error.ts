import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';

// Wrapper for async route handlers to catch unhandled promise rejections
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Global error handler
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Handle Multer file upload errors
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.message, code: 'UPLOAD_ERROR' });
    return;
  }

  // Handle generic errors securely (no stack traces sent to client)
  console.error('[Error]', err.stack || err.message || err);

  const statusCode = err.status || 500;
  const message = statusCode === 500 ? 'Internal server error' : err.message;

  res.status(statusCode).json({ error: message, code: err.code || 'SERVER_ERROR' });
};

// 404 Fallback Handler
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  res.status(404).json({ error: 'Endpoint not found', code: 'NOT_FOUND' });
};
