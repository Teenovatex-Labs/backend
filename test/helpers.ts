import { prisma } from '../src/db.js';
import { settleBadgeChecks } from '../src/lib/badges.js';

/** Empties every table so each suite starts from a clean slate. */
export const resetDb = async () => {
  // Background badge checks from the previous test must finish first, or they deadlock with the TRUNCATE.
  await settleBadgeChecks();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
};

/** A valid answer to whatever Alfred just asked, whether it wants typed text, a pick, or a number. */
export const answerFor = (next: { format: string; spec?: { options?: string[]; min?: number } | null }, text: string) => {
  if (next.format === 'choice' || next.format === 'multi') return { choice: [next.spec!.options![0]!] };
  if (next.format === 'rank') return { choice: next.spec!.options! };
  if (next.format === 'scale' || next.format === 'slider') return { value: next.spec?.min ?? 1 };
  return { answer: text };
};
