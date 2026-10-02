# TeenovateX platform notes

## Principles
- **Everyone is equal.** No follow feature, no follower counts. Anyone can message anyone by username unless one has blocked the other. Popularity is not a feature.
- **Safe by other means:** blocks, reports, suspensions, the content filter (no contact details, off-platform requests, or links from accounts under 3 days old), moderator review of reported threads only, and an audit log of every staff action.
- Alfred's voice is the owner's persona in `src/lib/pet/persona.ts`. It is pinned by a SHA-256 test; never edit it.

## Roles
`member`, `mentor` (no extra powers yet), `moderator` (reports, suspensions, content), `admin` (everything, plus roles). Admins cannot change their own role. Emails in `ADMIN_EMAILS` become admin once verified.

## Hosts
- `teenovatex.org` landing, `app.teenovatex.org` members, `admin.teenovatex.org` staff sign-in and console (all one Next.js project on Vercel; DNS at Cloudflare, CNAME to `cname.vercel-dns.com`, DNS only).
- `api.teenovatex.org` the backend on the VPS. Every site origin must be in `FRONTEND_URL` (CORS).

## Server settings (`.env`, never committed)
`DATABASE_URL`, `JWT_*`, `FRONTEND_URL`, `ADMIN_EMAILS`, `GEMINI_API_KEYS`, `GROQ_API_KEYS`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (web push), `CLOUDINARY_*`, `RESEND_*`, optional `SENTRY_DSN`.

## Deploy
1. Backend: push to `main`, then on the server as `teenovatex`: `git pull`, `npm ci`, `npx prisma migrate deploy`, `npm run build`; `systemctl restart teenovatex-backend`; check `/health/ready`.
2. Frontend: push to `main`; Vercel builds it. CI also enforces the first-load JS budget (`scripts/check-budget.mjs`).
3. Migrations are additive only. Old tables (e.g. `Follow`) stay in the database, unused.

## Testing
- Backend: `npm test` (throwaway embedded Postgres). Load test: `loadtest/run.mjs` against a local or staging API only; it refuses production.
- Frontend: `npm test`, `npm run typecheck`, `npm run build`.

## Rewards
Daily quest (5 points) and three weekly challenges (15 to 25 points each, plus a 25-point bonus), counted from real activity on the member's own clock. Levels come from points; badges from real activity; streak freezes protect streaks.
