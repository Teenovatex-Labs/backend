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

## New host checklist
Each audience gets its own subdomain, and browser tokens are stored per origin, so each host has its own separate sign-in. To add a new host:

1. **Cloudflare CNAME**: add a DNS record for the subdomain pointing to `cname.vercel-dns.com` (DNS only, not proxied / gray-clouded).
2. **Vercel domain**: add the domain in the Vercel project (Settings → Domains).
3. **Backend CORS (`FRONTEND_URL`)**: add the origin to `FRONTEND_URL` in `.env` on the VPS (comma-separated list of allowed browser origins). Entries in `FRONTEND_URL` must be bare origins, no trailing slash, no wildcards.
4. **Vercel env**: set `NEXT_PUBLIC_*_ORIGIN` on Vercel (e.g. for the new surface in backend issue #6 / `src/lib/hosts.ts`; the variable name comes from the host registry plan).
5. **Restart backend**: run `systemctl restart teenovatex-backend` on the VPS so the server reloads `FRONTEND_URL`.
6. **Verify with a CORS preflight curl**: test that the API allows preflight requests from the new origin:
   ```bash
   curl -i -X OPTIONS https://api.teenovatex.org/health \
     -H "Origin: https://app.teenovatex.org" \
     -H "Access-Control-Request-Method: GET"
   ```
   **What a pass looks like:**
   - HTTP status `204 No Content`
   - Header `access-control-allow-origin: https://app.teenovatex.org` (matches the request Origin exactly)
   - Header `access-control-allow-credentials: true`
   - If rejected, `access-control-allow-origin` is omitted completely.

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
