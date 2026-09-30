import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { SPACES } from '../prisma/content/spaces.js';

dotenv.config();
const prisma = new PrismaClient();

for (const [position, s] of SPACES.entries()) {
  await prisma.space.upsert({
    where: { slug: s.slug },
    create: { ...s, position },
    update: { name: s.name, description: s.description, position },
  });
  console.log(`✓ ${s.name}`);
}
await prisma.$disconnect();
