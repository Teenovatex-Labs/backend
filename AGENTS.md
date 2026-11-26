# Agent guidance: TeenovateX infrastructure

Read [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) before changing deployment, DNS, API configuration, database, or backups.

- Live frontend: Vercel project `teenovatex`, repo `Teenovatex-Labs/frontend`.
- Live API and PostgreSQL 18: Oracle A1 `teenovatex-a1` at `132.145.70.153`, repo `Teenovatex-Labs/backend`, Docker Compose under `/home/ubuntu/teenovatex`.
- `api.teenovatex.org` points to A1 through Cloudflare DNS only. The frontend uses `https://api.teenovatex.org/api/v1`.
- Neon PostgreSQL was the migration source. The separate new Neon Storage bucket holds offsite custom-format database dumps; it is not a live DB replica.
- The old shared VPS at `145.241.215.176` runs other projects. Its TeenovateX files, container, and image tags were removed. Preserve its Caddy bridge for cached API DNS until intentionally retired; never touch unrelated services.
- Keep SSH keys, secrets, dumps, and local environment files out of Git. Validate production migrations and take a backup before destructive changes. Check both `/health/ready` and the backup destination after work.

The full restore and operations runbook is in [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md).
