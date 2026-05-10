import { prisma } from '../db.js';

export const createNotification = async (userId: string, type: string, message: string) => {
  await prisma.notification.create({
    data: { user_id: userId, type, message },
  });
};
