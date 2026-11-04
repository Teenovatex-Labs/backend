import { Router } from 'express';
import { z } from 'zod';
import { approvePairing, closePairing, createPairing, getPairing, listPairings, myPairings, setClearance, suggestions } from '../controllers/pairingAdmin.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const createSchema = z.object({
  member_ids: z.array(z.string().uuid()).min(2).max(3),
  goal: z.string().trim().min(10).max(300),
  rationale: z.string().trim().max(1500).optional(),
  ends_on: day,
  supervisor_id: z.string().uuid().optional(),
});

/** Mounted at /admin: the pairing tool and the safeguarding clearance it depends on. */
export const adminPairingRouter = Router();
adminPairingRouter.use(requireAuth);
adminPairingRouter.get('/pairing/suggestions', requirePermission('pairing.manage'), suggestions);
adminPairingRouter.get('/pairings', requirePermission('pairing.manage'), listPairings);
adminPairingRouter.post('/pairings', requirePermission('pairing.manage'), validate(createSchema), createPairing);
adminPairingRouter.get('/pairings/:id', requirePermission('pairing.manage'), getPairing);
adminPairingRouter.post('/pairings/:id/approve', requirePermission('pairing.manage'), approvePairing);
adminPairingRouter.post('/pairings/:id/close', requirePermission('pairing.manage'), validate(z.object({ reason: z.string().trim().min(5).max(300) })), closePairing);
adminPairingRouter.post('/members/:id/safeguarding-clearance', requirePermission('pairing.manage'), validate(z.object({ cleared: z.boolean(), note: z.string().trim().max(300).optional() })), setClearance);

export const pairingRouter = Router();
pairingRouter.get('/mine', requireAuth, myPairings);
