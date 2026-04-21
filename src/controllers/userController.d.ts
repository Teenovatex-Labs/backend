import type { Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware.js';
export declare const getProfile: (req: AuthRequest, res: Response) => Promise<void>;
export declare const updateProfile: (req: AuthRequest, res: Response) => Promise<void>;
export declare const deleteProfile: (req: AuthRequest, res: Response) => Promise<void>;
//# sourceMappingURL=userController.d.ts.map