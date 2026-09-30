import type { Prisma } from '@prisma/client';
import { prisma } from '../src/db.js';
import { generateAccessToken } from '../src/lib/tokens.js';

const tag = () => Math.random().toString(36).slice(2, 9);

/** A verified adult member with a working access token. Override anything you need. */
export const makeUser = async (overrides: Partial<Prisma.UserUncheckedCreateInput> = {}) => {
  const t = tag();
  const user = await prisma.user.create({
    data: {
      email: `u_${t}@example.com`,
      username: `u_${t}`,
      full_name: 'Test Member',
      email_verified: true,
      birth_date: new Date('2008-05-10T00:00:00.000Z'),
      settings: { create: {} },
      ...overrides,
    },
  });
  return { user, auth: { Authorization: `Bearer ${generateAccessToken(user.id)}` } };
};

export const makeProject = (user_id: string, overrides: Partial<Prisma.ProjectUncheckedCreateInput> = {}) => {
  const t = tag();
  return prisma.project.create({
    data: {
      user_id,
      name: `Lab ${t}`,
      slug: `lab-${t}`,
      short_description: 'A test lab',
      description: 'A lab made for tests',
      category: 'web',
      ...overrides,
    },
  });
};
