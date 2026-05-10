import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

export const validate =
  (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const msg = result.error.errors[0]?.message ?? 'Validation failed';
      res.status(400).json({ error: msg, code: 'VALIDATION_ERROR' });
      return;
    }
    req.body = result.data;
    next();
  };
