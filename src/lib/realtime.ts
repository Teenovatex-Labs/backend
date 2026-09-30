import type { Response } from 'express';

// Live updates pushed to a member's open browser tabs (new message, new notification), so the app
// doesn't have to wait for its next poll. It lives in this process's memory: fine for one server,
// and if a message is missed the normal polling still catches it.

export type LiveEvent = { type: 'message'; conversation_id: string } | { type: 'notification' };

const MAX_PER_USER = 4;
const connections = new Map<string, Set<Response>>();

export const connectedCount = (userId: string) => connections.get(userId)?.size ?? 0;

export function register(userId: string, res: Response): () => void {
  let set = connections.get(userId);
  if (!set) connections.set(userId, (set = new Set()));
  // A member with many tabs open gets the newest few; the oldest connection is closed to make room.
  while (set.size >= MAX_PER_USER) {
    const oldest = set.values().next().value as Response;
    set.delete(oldest);
    oldest.end();
  }
  set.add(res);
  return () => {
    set!.delete(res);
    if (set!.size === 0) connections.delete(userId);
  };
}

export function publish(userId: string, event: LiveEvent): void {
  const set = connections.get(userId);
  if (!set) return;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try {
      res.write(line);
    } catch {
      set.delete(res);
    }
  }
}
