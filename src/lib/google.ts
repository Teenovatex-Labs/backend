import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';

const client = new OAuth2Client(config.googleClientId);

/** Checks a Google ID token and returns who it belongs to, or null if it isn't valid. */
export const verifyGoogleToken = async (idToken: string): Promise<{ sub: string; email?: string } | null> => {
  if (!config.googleClientId) return null;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: config.googleClientId });
    const payload = ticket.getPayload();
    return payload?.sub ? { sub: payload.sub, email: payload.email } : null;
  } catch {
    return null;
  }
};
