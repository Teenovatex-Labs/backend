// Usage: npm run role -- <email> <member|mentor|moderator|admin>
// Runs against whatever DATABASE_URL points at, so on the server it changes real roles.
import { prisma } from '../src/db.js';

const [email, role] = process.argv.slice(2);
const roles = ['member', 'mentor', 'moderator', 'admin'] as const;
type RoleName = (typeof roles)[number];

if (!email || !roles.includes(role as RoleName)) {
  console.error(`Usage: npm run role -- <email> <${roles.join('|')}>`);
  process.exit(1);
}

const user = await prisma.user.update({ where: { email }, data: { role: role as RoleName }, select: { email: true, role: true } });
console.log(`${user.email} is now ${user.role}`);
await prisma.$disconnect();
