import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { TRACKS } from '../prisma/content/learn.js';

dotenv.config();
const prisma = new PrismaClient();

// Safe to run any time: tracks and lessons are matched by slug and updated in place, so members'
// progress is kept. Lessons removed from the content file are left alone.
for (const [trackIndex, track] of TRACKS.entries()) {
  const saved = await prisma.track.upsert({
    where: { slug: track.slug },
    create: { slug: track.slug, title: track.title, description: track.description, position: trackIndex },
    update: { title: track.title, description: track.description, position: trackIndex },
  });
  for (const [lessonIndex, lesson] of track.lessons.entries()) {
    const data = { title: lesson.title, summary: lesson.summary, body: lesson.body, minutes: lesson.minutes, position: lessonIndex };
    await prisma.lesson.upsert({
      where: { track_id_slug: { track_id: saved.id, slug: lesson.slug } },
      create: { track_id: saved.id, slug: lesson.slug, ...data },
      update: data,
    });
  }
  console.log(`✓ ${track.title} (${track.lessons.length} lessons)`);
}
await prisma.$disconnect();
