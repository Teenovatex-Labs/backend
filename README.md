# TeenovateX backend

Backend API for the TeenovateX platform.

## Stack

Versions below are those declared in `package.json`:

- Express `^5.2.1`
- TypeScript `^6.0.3` with ESM (`"type": "module"`)
- Prisma CLI and client `^6.0.0`
- PostgreSQL (the Prisma schema uses the PostgreSQL provider)

## Environment

Use the [`.env.example`](.env.example) file as the environment configuration reference.

## Development and checks

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the API with `tsx` watch mode using `src/app.ts`. |
| `npm run db:local` | Starts a persistent embedded PostgreSQL database in `.local-db`, applies Prisma migrations, seeds a local test member if needed, and keeps the database running. |
| `npm test` | Runs the Vitest suite once (`vitest run`). |
| `npm run typecheck` | Runs TypeScript no-emit checks for the application and test configuration. |

## Deployment

See [the platform deployment notes](docs/PLATFORM.md). For the backend, after pushing to `main`, run `git pull`, `npm ci`, `npx prisma migrate deploy`, and `npm run build` on the server as `teenovatex`; restart `teenovatex-backend` with systemd and check `/health/ready`.
