import type { Response } from 'express';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import { invalidateSettingCache, listSettings, parseSettingValue, settingDefinitions } from '../lib/settings.js';
import type { AuthRequest } from '../middleware/auth.js';
import { settingsPatchSchema } from '../schemas/settings-admin.js';

export const getSettings = async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ items: await listSettings() });
};

export const patchSetting = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = settingsPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid setting');
  }
  if (!req.userId) throw new HttpError(401, 'UNAUTHORIZED', 'Unauthorized');

  const { key, value } = parsed.data;
  await prisma.$transaction(async (tx) => {
    const current = await tx.systemSetting.findUnique({ where: { key }, select: { value: true } });
    const oldValue = current ? parseSettingValue(key, current.value) : settingDefinitions[key].default;
    await tx.systemSetting.upsert({
      where: { key },
      create: { key, value, updated_by: req.userId! },
      update: { value, updated_by: req.userId! },
    });
    await audit(req.userId!, 'settings.update', { type: 'setting', id: key }, { key, old_value: oldValue, new_value: value }, tx);
  });

  invalidateSettingCache(key);
  const updated = await prisma.systemSetting.findUniqueOrThrow({ where: { key } });
  res.json({
    key,
    value: parseSettingValue(key, updated.value),
    updated_by: updated.updated_by,
    updated_at: updated.updated_at,
  });
};
