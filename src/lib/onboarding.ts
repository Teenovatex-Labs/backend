import { config } from '../config.js';

/**
 * What a new member does in their first week. `confirm` steps are the member's own word, so they
 * are a nudge, not proof. Joining the Hack Club Dashboard (HCB) is a required step, per the admissions spec.
 */
export const STEPS = [
  { key: 'conduct', title: 'Read and accept the code of conduct', required: true, kind: 'confirm' },
  { key: 'whatsapp', title: 'Join the community WhatsApp group', required: true, kind: 'confirm' },
  { key: 'profile', title: 'Add a short bio to your profile', required: true, kind: 'derived' },
  { key: 'hcb', title: 'Join the Hack Club Dashboard (HCB) with the invite link', required: true, kind: 'confirm' },
] as const;

export type StepKey = (typeof STEPS)[number]['key'];
export const CONFIRMABLE = STEPS.filter((s) => s.kind === 'confirm').map((s) => s.key) as string[];

/** Tracking parameters are noise at best and a privacy leak at worst, so links go out without them. */
export const cleanLink = (raw: string | undefined): string | null => {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) if (k.toLowerCase().startsWith('utm_') || k === 'fbclid' || k === 'gclid') u.searchParams.delete(k);
    return u.toString();
  } catch {
    return null;
  }
};

export const stepLink = (key: StepKey) =>
  key === 'whatsapp' ? cleanLink(config.onboarding.whatsappUrl) : key === 'hcb' ? cleanLink(config.onboarding.hcbUrl) : null;
