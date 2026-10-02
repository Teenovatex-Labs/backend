import webpush from 'web-push';
import { config } from '../config.js';
import { prisma } from '../db.js';

const { publicKey, privateKey, subject } = config.push;
export const pushEnabled = Boolean(publicKey && privateKey);
if (pushEnabled) webpush.setVapidDetails(subject, publicKey!, privateKey!);

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/**
 * Sends a push to every device a member has allowed. Never throws: a notification must still be saved
 * if push is down. Devices the browser says are gone (404/410) are forgotten.
 */
export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  if (!pushEnabled) return;
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { user_id: userId } });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await prisma.pushSubscription.deleteMany({ where: { id: s.id } });
        }
      }),
    );
  } catch {
    // push is best-effort
  }
}
