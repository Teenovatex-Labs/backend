import { Router } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { register } from '../lib/realtime.js';

const router = Router();

// A long-lived response that stays open. Authenticated like any other request (Authorization header),
// which is why the app reads it with fetch rather than EventSource, which can't send headers.
router.get('/', requireAuth, (req: AuthRequest, res) => {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Tells nginx not to hold the response back waiting for more.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  const unregister = register(req.userId!, res);
  // A comment line every 25s keeps proxies from closing an idle connection.
  const beat = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(beat);
    unregister();
  });
});

export default router;
