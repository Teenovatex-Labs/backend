import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { HttpError } from './errors.js';

export const settingKeys = [
  'announcement_default_expiry_days',
  'partner_min_cohort_size',
  'maintenance_banner',
  'whatsapp_invite_url',
  'inactive_review_days',
] as const;

export type SettingKey = (typeof settingKeys)[number];
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingDefinitions)[K]['schema']>;

const whatsappInviteUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    if (value === '') return true;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'chat.whatsapp.com' && url.pathname.length > 1 && !url.search && !url.hash;
    } catch {
      return false;
    }
  }, 'Use an HTTPS chat.whatsapp.com invite URL');

export const settingDefinitions = {
  announcement_default_expiry_days: { default: 30, schema: z.number().int().min(1).max(365) },
  partner_min_cohort_size: { default: 10, schema: z.number().int().min(10).max(1000) },
  maintenance_banner: { default: '', schema: z.string().trim().max(500) },
  whatsapp_invite_url: { default: config.onboarding.whatsappUrl || '', schema: whatsappInviteUrlSchema },
  inactive_review_days: { default: 14, schema: z.number().int().min(1).max(365) },
} satisfies Record<SettingKey, { default: unknown; schema: z.ZodType }>;

const CACHE_TTL_MS = 30_000;
type AnySettingValue = SettingValue<SettingKey>;
const cache = new Map<SettingKey, { value: AnySettingValue; expiresAt: number }>();

const defaultValue = <K extends SettingKey>(key: K): SettingValue<K> =>
  settingDefinitions[key].default as SettingValue<K>;

export const parseSettingValue = <K extends SettingKey>(key: K, value: unknown): SettingValue<K> => {
  const parsed = settingDefinitions[key].schema.safeParse(value);
  if (!parsed.success) throw new HttpError(500, 'INVALID_STORED_SETTING', `Stored value for "${key}" is invalid`);
  return parsed.data as SettingValue<K>;
};

const cacheValue = <K extends SettingKey>(key: K, value: SettingValue<K>): void => {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
};

export const getSetting = async <K extends SettingKey>(key: K): Promise<SettingValue<K>> => {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as SettingValue<K>;
  if (cached) cache.delete(key);

  const row = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  const value = row ? parseSettingValue(key, row.value) : parseSettingValue(key, defaultValue(key));
  cacheValue(key, value);
  return value;
};

export const listSettings = async () => {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: [...settingKeys] } } });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return settingKeys.map((key) => {
    const row = byKey.get(key);
    const value = row ? parseSettingValue(key, row.value) : parseSettingValue(key, defaultValue(key));
    cacheValue(key, value);
    return {
      key,
      value,
      updated_by: row?.updated_by ?? null,
      updated_at: row?.updated_at ?? null,
    };
  });
};

export const invalidateSettingCache = (key?: SettingKey): void => {
  if (key) cache.delete(key);
  else cache.clear();
};
