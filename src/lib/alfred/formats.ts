export const FORMATS = ['text', 'choice', 'multi', 'scale', 'slider'] as const;
export type Format = (typeof FORMATS)[number];

/** What an applicant is shown for a non-text question. Typed answers have no spec. */
export type Spec = { options?: string[]; min?: number; max?: number; low?: string; high?: string };

const CONTACT = /https?:|www\.|@|\d{7,}/i;
const label = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() && v.trim().length <= max && !CONTACT.test(v) ? v.trim() : undefined);

/** Fixed ranges: a 1 to 5 scale and a 0 to 10 slider. */
const RANGE: Record<'scale' | 'slider', [number, number]> = { scale: [1, 5], slider: [0, 10] };

/** Checks what the AI proposed for a question's format, and returns a safe spec or null if it should be a typed question. */
export const acceptSpec = (format: unknown, raw: { options?: unknown; low?: unknown; high?: unknown }): { format: Format; spec: Spec | null } | null => {
  if (format === undefined || format === 'text') return { format: 'text', spec: null };
  if (format === 'choice' || format === 'multi') {
    if (!Array.isArray(raw.options)) return null;
    const options = raw.options.map((o) => label(o, 70));
    if (options.length < 2 || options.length > 6 || options.some((o) => !o) || new Set(options).size !== options.length) return null;
    return { format, spec: { options: options as string[] } };
  }
  if (format === 'scale' || format === 'slider') {
    const [min, max] = RANGE[format];
    return { format, spec: { min, max, low: label(raw.low, 30), high: label(raw.high, 30) } };
  }
  return null;
};

export type AnswerInput = { text?: string; choice?: string[]; value?: number; note?: string };
export type Composed = { ok: true; text: string; json: Record<string, unknown> } | { ok: false; message: string };

/**
 * Turns whatever the applicant picked into the text everything downstream reads (safety checks, reviewers, summaries),
 * and keeps the structured choice alongside it. A note is optional for non-typed questions.
 */
export const composeAnswer = (format: string, spec: Spec | null, input: AnswerInput): Composed => {
  const note = input.note?.trim() || undefined;
  if (format === 'choice' || format === 'multi') {
    const options = spec?.options ?? [];
    const picked = [...new Set(input.choice ?? [])];
    if (picked.length === 0 || picked.some((p) => !options.includes(p))) return { ok: false, message: 'Pick one of the options.' };
    if (format === 'choice' && picked.length !== 1) return { ok: false, message: 'Pick just one.' };
    return { ok: true, text: [picked.join('; '), note].filter(Boolean).join(' — '), json: { text: [picked.join('; '), note].filter(Boolean).join(' — '), choice: picked, note } };
  }
  if (format === 'scale' || format === 'slider') {
    const min = spec?.min ?? 0;
    const max = spec?.max ?? 10;
    const v = input.value;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return { ok: false, message: `Pick a number from ${min} to ${max}.` };
    const text = [`${v} out of ${max}${spec?.low && spec?.high ? ` (${min} = ${spec.low}, ${max} = ${spec.high})` : ''}`, note].filter(Boolean).join(' — ');
    return { ok: true, text, json: { text, value: v, note } };
  }
  const text = input.text?.trim();
  if (!text) return { ok: false, message: 'Write an answer first' };
  return { ok: true, text, json: { text } };
};
