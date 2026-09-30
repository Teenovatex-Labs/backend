import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

// A private Postgres for local development, so running the app or a migration on your
// machine can never touch the live Neon database. Data lives in .local-db (git-ignored).
// LOCAL_DB_DIR / LOCAL_DB_PORT let a second, separate local database run beside this one.
const dir = path.resolve(process.env.LOCAL_DB_DIR ?? '.local-db');
const port = Number(process.env.LOCAL_DB_PORT ?? 54329);
const url = `postgresql://tx:tx@localhost:${port}/tx_dev`;

const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'tx', password: 'tx', port, persistent: true, onLog: () => {} });

if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase('tx_dev');
} catch {
  // Already exists from an earlier run.
}

execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });

// A ready-made member for local testing (this database is local-only).
process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'development';
const { prisma } = await import('../src/db.js');
const bcrypt = (await import('bcryptjs')).default;
const email = 'dev@teenovatex.test';
if (!(await prisma.user.findUnique({ where: { email } }))) {
  await prisma.user.create({
    data: {
      email,
      username: 'devtester',
      full_name: 'Dev Tester',
      password_hash: await bcrypt.hash('DevPass123', 12),
      email_verified: true,
    },
  });
  console.log(`Seeded a local test member: ${email}`);
}
await prisma.$disconnect();

console.log(`\nLocal database ready: ${url}\nLeave this running while you develop. Ctrl+C to stop.\n`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
