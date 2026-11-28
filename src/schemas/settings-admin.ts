import { z } from 'zod';
import { settingDefinitions } from '../lib/settings.js';

export const settingsPatchSchema = z.discriminatedUnion('key', [
  z.object({
    key: z.literal('announcement_default_expiry_days'),
    value: settingDefinitions.announcement_default_expiry_days.schema,
  }).strict(),
  z.object({
    key: z.literal('partner_min_cohort_size'),
    value: settingDefinitions.partner_min_cohort_size.schema,
  }).strict(),
  z.object({
    key: z.literal('maintenance_banner'),
    value: settingDefinitions.maintenance_banner.schema,
  }).strict(),
  z.object({
    key: z.literal('whatsapp_invite_url'),
    value: settingDefinitions.whatsapp_invite_url.schema,
  }).strict(),
  z.object({
    key: z.literal('inactive_review_days'),
    value: settingDefinitions.inactive_review_days.schema,
  }).strict(),
]);
