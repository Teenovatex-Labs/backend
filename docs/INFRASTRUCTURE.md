# TeenovateX infrastructure and recovery

Updated 26 November 2026 after the API and database migration. This document applies to both `Teenovatex-Labs/frontend` and `Teenovatex-Labs/backend`.

## Live architecture

| Component | Current home | Notes |
| --- | --- | --- |
| Website, member app, admin UI | Vercel, built from `Teenovatex-Labs/frontend` | `teenovatex.org` (redirects to `www`), `www.teenovatex.org`, `app.teenovatex.org`, `admin.teenovatex.org`, `partners.teenovatex.org`, and `tutors.teenovatex.org` are verified Vercel domains. These are not hosted on the VPS. |
| Public API | New Oracle Cloud account `teenovatexlabs`, VM `teenovatex-a1`, `132.145.70.153` | Ubuntu 24.04 ARM64 Ampere A1, 2 OCPU, 12 GB RAM. Caddy serves `https://api.teenovatex.org` on 80/443 and proxies to `127.0.0.1:4100`. |
| API process | Docker Compose `api` service on A1 | Source at `/home/ubuntu/teenovatex/backend`; Compose file at `/home/ubuntu/teenovatex/docker-compose.yml`. Deploy using the backend's `ops/deploy.sh` after reviewing migrations. |
| Live PostgreSQL | Docker Compose `db` service on the same A1 VM | PostgreSQL 18, database and role `teenovatex`, persistent Docker volume. Only the private Compose network can reach port 5432; no public DB listener. |
| DNS | Cloudflare zone `teenovatex.org` | `api` A record is DNS only to `132.145.70.153`. Keep other frontend DNS records as configured for Vercel. |
| Database backup | A1 local storage and Neon object storage | `/usr/local/sbin/teenovatex-backup` runs daily at 03:10 UTC from `/etc/cron.d/teenovatex`. Local PostgreSQL custom dumps live under `/var/backups/teenovatex` with 14-day local retention. The same dump is uploaded to the Neon Storage `uploads` bucket under `backups/teenovatex/`. This Neon project is backup storage, **not** the live database or an automatic failover replica. |

The VM can be reached as `ubuntu@132.145.70.153` with the **new A1 SSH private key**, stored outside Git. Caddy uses an automatically managed public TLS certificate. The API's production environment is `/home/ubuntu/teenovatex/backend/.env`; the database password file and offsite backup credentials are on the host, not in either repository. Never paste them into issues, logs, docs, or commits.

## Migration boundary and old VPS

On 26 November 2026, writes to the old TeenovateX API were stopped; a fresh PostgreSQL 18 dump was taken from the original Neon database and restored on A1. The final dump SHA-256 was `2fa694931363e91cdbc3a1ac4e863e0478b2de0525305eb2ee193a41a43ed1f3`, with 66 public tables restored. The new API answered `200` at `/health/ready` over verified HTTPS. A fresh local and offsite backup completed after the restore.

The previous Oracle account `anasmasama` has a **shared** VPS `145.241.215.176` that hosts unrelated projects. The old TeenovateX directory, stopped API container, and TeenovateX image tags were removed after the new API, database, and offsite backup were verified. It is not the TeenovateX database or API host anymore. Its Caddy gateway temporarily proxies only `api.teenovatex.org` to `https://132.145.70.153` with SNI `api.teenovatex.org` so clients with cached old DNS can still reach the new API. Do not stop the shared gateway, remove the VPS, or modify other site routes. The original Neon PostgreSQL project is a historical source; production writes now go to A1. Do not assume it stays synchronized. The mistakenly created paid E5 VM in the new account was terminated.

## Routine checks

```bash
curl -fsS https://api.teenovatex.org/health/ready
ssh -i /path/to/new-a1-key ubuntu@132.145.70.153
cd /home/ubuntu/teenovatex
sudo docker compose ps
sudo systemctl status caddy cron
sudo docker exec teenovatex-db-1 pg_isready -U teenovatex -d teenovatex
```

Expect HTTP 200, healthy PostgreSQL, and running `api`, `db`, Caddy, and cron. Verify the Cloudflare `api` A record still points to the A1 IP. The public TLS certificate must validate without `curl -k`. The Vercel production and preview `NEXT_PUBLIC_API_URL` is `https://api.teenovatex.org/api/v1`; the latest production deployment was READY when checked on 26 November 2026.

## Deploying the API

The backend repository's `ops/deploy.sh` describes the Docker deployment; check it against this runbook before running it, particularly the repository checkout and Docker permissions on A1. On A1, the repository is at `/home/ubuntu/teenovatex/backend`; pull the reviewed `main` revision, rebuild `api`, run `npx prisma migrate deploy` from that container against the local `db`, restart only `api`, and verify `/health/ready`. Review migration SQL and take a backup first if a migration could remove data. Do not point `DATABASE_URL` back at Neon. Frontend pushes deploy through Vercel; check its environment variables and production hosts there.

## Backups and restore

Check `/var/backups/teenovatex` for local dumps and the Neon Storage `uploads/backups/teenovatex/` prefix for an offsite copy. Run `sudo /usr/local/sbin/teenovatex-backup` for an on-demand backup. The script reports both local and offsite success; investigate a failed upload rather than treating a local dump as sufficient. Local retention is 14 days; do not assume an offsite retention policy unless it is configured separately.

To restore, choose and verify a PostgreSQL custom-format dump first. Stop only the TeenovateX `api` service to prevent writes; take a pre-restore dump of the current A1 database; restore to the `teenovatex` database with PostgreSQL 18 `pg_restore --exit-on-error --no-owner --no-acl`; then restart `api` and check `/health/ready`, important data, and HTTPS. A restore replaces live data and needs a deliberate cutover plan. The backup bucket is not a running PostgreSQL server. If the A1 VM itself is lost, provision a new ARM64 Ubuntu host with Docker and PostgreSQL 18, retrieve a verified offsite dump, restore it, deploy the API, configure Caddy/TLS, and update only the Cloudflare `api` A record.

## Security and ownership

Only ports 80/443 (public API) and 22 (SSH) should be reachable on A1; 5432 is private. Keep SSH keys, `.env`, `db_password`, `.backup-s3.env`, dumps, and cloud credentials out of Git. Rotate exposed credentials through their providers and update the host files without printing secrets. The A1 and old VPS are separate Oracle accounts. Other workloads on the old VPS belong to different projects; scope every old-host operation to TeenovateX.
