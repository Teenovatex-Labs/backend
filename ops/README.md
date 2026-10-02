# Server operations

What runs on the VPS besides the API itself. Copies of the scripts live here so the setup can be rebuilt.

| What | Where on the server | When |
| --- | --- | --- |
| Database backup | `/usr/local/bin/teenovatex-backup` → `/var/backups/teenovatex/*.sql.gz` | nightly 03:10 UTC, keeps 14 days |
| Health watchdog | `/usr/local/bin/teenovatex-watchdog` | every 5 min; restarts the API after 2 failed readiness checks |
| Schedule | `/etc/cron.d/teenovatex` | |

## Restoring a backup

    gunzip -c /var/backups/teenovatex/teenovatex-YYYYMMDDTHHMMSSZ.sql.gz | psql "<direct Neon URL, without -pooler>"

The dump uses `--clean --if-exists`, so restoring replaces existing tables. Try it on a Neon branch first.

## Known limits

- Backups sit on the same server. Copy them off-site (or turn on Neon's point-in-time restore) so one disaster can't take both.
- The watchdog only checks the API process and database reachability, not the website itself.

## Environment

See `.env.example`. Secrets (AI provider keys, `ADMIN_EMAILS`) live only in `/home/TeenovateX-Labs/backend/.env` on the server.

## nginx upload size
The API's nginx site (`/etc/nginx/sites-enabled/api.teenovatex.org`) must set `client_max_body_size 6m;`. nginx's default is 1 MB, which silently rejected profile photos, lab covers and chat images with a 413 before the app saw them. The app itself caps uploads at 5 MB, and the browser shrinks photos before sending. After editing: `nginx -t && systemctl reload nginx`.
