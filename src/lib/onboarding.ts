import { config } from '../config.js';

/**
 * What a new member does in their first week. `confirm` steps are the member's own word, so they
 * are a nudge, not proof. Joining the Hack Club Dashboard (HCB) is a required step, per the admissions spec.
 */
export const STEPS = [
  { key: 'welcome', title: 'Welcome: see how your first week works', required: true, kind: 'confirm' },
  { key: 'conduct', title: 'Read and accept the code of conduct', required: true, kind: 'confirm' },
  { key: 'safeguarding', title: 'Read how we keep members safe, and who to tell if something feels wrong', required: true, kind: 'confirm' },
  { key: 'profile', title: 'Add a short bio to your profile', required: true, kind: 'derived' },
  { key: 'whatsapp', title: 'Join the community WhatsApp group', required: true, kind: 'confirm' },
  { key: 'intro', title: 'Write a short introduction and post it in the group', required: true, kind: 'derived' },
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

export const INTRO_MIN = 20;
export const INTRO_MAX = 500;

/** A starting bio built from what the member already told us when they applied. Plain wording, no AI, always editable. */
export const suggestBio = (firstName: string, interests: string[], goals: string[]): string => {
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const parts = [`I'm ${firstName}.`];
  if (interests.length) parts.push(`I'm into ${list(interests.slice(0, 3))}.`);
  if (goals.length) parts.push(`I want to learn ${list(goals.slice(0, 2))}.`);
  if (parts.length === 1) parts.push('I joined TeenovateX to learn and build with other teens.');
  return parts.join(' ').slice(0, 200);
};
