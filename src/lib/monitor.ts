import * as Sentry from '@sentry/node';
import { config } from '../config.js';

// Error alerts. Off unless SENTRY_DSN is set. This is a platform for teenagers, so nothing personal
// is sent: no request bodies, headers, cookies, IP addresses or user details, only what failed and where.
export const monitoringEnabled = Boolean(config.sentryDsn);

if (monitoringEnabled) {
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.env,
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      return event;
    },
  });
}

/** Reports an unexpected failure. Safe to call when monitoring is off. */
export function reportError(err: unknown): void {
  if (monitoringEnabled) Sentry.captureException(err);
}
