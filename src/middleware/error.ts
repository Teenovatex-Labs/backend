import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';


export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };


export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.message, code: 'UPLOAD_ERROR' });
    return;
  }

  
  console.error('[Error]', err.stack || err.message || err);

  const statusCode = err.status || 500;
  const message = statusCode === 500 ? 'Internal server error' : err.message;

  res.status(statusCode).json({ error: message, code: err.code || 'SERVER_ERROR' });
};


export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  res.status(404).json({ error: 'Endpoint not found', code: 'NOT_FOUND' });
};
