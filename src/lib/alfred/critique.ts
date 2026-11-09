import { CRITERIA, type Criterion } from '../rubric.js';
import type { Spec } from './formats.js';
import { REACTION_TYPES, type ReactionType, type Tone } from './persona.js';

// A deterministic quality gate for what the model writes. It is deliberately boring: a list of rules we can test, not
// another model's opinion. A "hard" problem means the turn is thrown away (one retry, then the fixed bank takes over).
// A "soft" problem only costs Alfred his reaction: the question can still be asked without it.

export type Reaction = { type: ReactionType; text: string };
export type Draft = { reaction: Reaction | null; question: string; mode: 'new' | 'follow_up'; shows: Criterion[] };
export type Problem = { level: 'hard' | 'soft'; code: string; message: string };
export type Past = { question: string; reaction?: string | null; answer?: string };
export type Context = { past: Past[]; tone: Tone; serious: boolean; noExperience: boolean; beginner: boolean; allowFollowUp: boolean; first: boolean };

const CONTACT = /https?:|www\.|@|\d{7,}/i;

const GENERIC = [
  /why do you want to (join|be part)/i,
  /describe (a|the) (challenge|time|situation)/i,
  /what (skills|strengths|weaknesses) do you have/i,
  /what are your (future )?(goals|strengths|weaknesses)/i,
  /tell (us|me) about (a|the) (project|time|challenge)/i,
  /where do you see yourself/i,
  /what (motivates|inspires) you\b/i,
  /describe your (design|work|learning) process/i,
];

const SLANG = /\b(no cap|ngl|fr fr|on god|slay(ed|ing)?|bussin|rizz|vibe check|lowkey|highkey|sus|bestie|skibidi|bruh|periodt|yeet|fam)\b/i;
const PRAISE = /\b(that'?s|that is|this is|what an?) (so )?(amazing|awesome|incredible|fantastic|wonderful|impressive)\b|\b(wow|great answer|great job|well done|i love (that|this)|love that)\b/i;
const EMOJI = /\p{Extended_Pictographic}/gu;
const OPENER = /^(imagine|you have been given|you['’]ve been given|you are given|suppose|picture this)\b/i;
const PROJECT_ASSUMED = /\b(your|the) (last|best|biggest|favou?rite|latest|first) (project|app|website|startup|game)\b|\bthe (app|project|website|game|startup) you (built|made|created|launched)\b/i;
const ASKS_AI = /\b(use|using) (chatgpt|an ai|ai)\b/i;

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2);
const similarity = (a: string, b: string) => {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
};
const emojiCount = (s: string) => (s.match(EMOJI) ?? []).length;
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean);

export const MAX_QUESTION = 260;
export const MAX_REACTION = 220;

export const critique = (d: Draft, ctx: Context): Problem[] => {
  const out: Problem[] = [];
  const hard = (code: string, message: string) => out.push({ level: 'hard', code, message });
  const soft = (code: string, message: string) => out.push({ level: 'soft', code, message });
  const q = d.question.trim();
  const turn = `${d.reaction?.text ?? ''} ${q}`;

  if (q.length < 15 || !q.includes('?')) hard('shape', 'The question must be a real question of at least 15 characters.');
  if (q.length > MAX_QUESTION) hard('long', `The question must be at most ${MAX_QUESTION} characters.`);
  if ((q.match(/\?/g) ?? []).length > 1) hard('double', 'Ask exactly one question; there is more than one question mark.');
  if (CONTACT.test(turn)) hard('contact', 'No links, emails or phone numbers.');
  if (ASKS_AI.test(q)) hard('ai', 'Never tell them to use an AI.');
  if (GENERIC.some((g) => g.test(q))) hard('generic', 'That is a stock interview question. Ask something only this applicant could be asked.');
  if (SLANG.test(turn)) hard('slang', 'Remove the slang; Alfred does not talk like that.');
  if (OPENER.test(q)) {
    const recent = ctx.past.slice(-2).filter((p) => OPENER.test(p.question)).length;
    if (recent > 0 || ctx.first) hard('opener', 'Do not open with "Imagine" or similar again. Vary how you start.');
  }
  for (const p of ctx.past) {
    if (similarity(q, p.question) >= 0.6) {
      hard('repeat', 'That is too close to a question already asked.');
      break;
    }
  }
  if ((ctx.noExperience || ctx.beginner) && PROJECT_ASSUMED.test(q)) hard('assumes', 'Do not assume they have built or launched anything.');
  if (d.mode === 'follow_up' && !ctx.allowFollowUp) hard('mode', 'A follow-up is not allowed this turn; start a new thread.');
  if (ctx.first && (d.reaction || d.mode === 'follow_up')) hard('first', 'The first turn has nothing to react to.');

  const r = d.reaction;
  if (r) {
    if (!REACTION_TYPES.includes(r.type)) soft('rtype', 'Unknown reaction type.');
    if (r.text.trim().length < 3 || r.text.length > MAX_REACTION || sentences(r.text).length > 3) soft('rlong', 'Keep the reaction to one or two short sentences.');
    if (PRAISE.test(r.text)) soft('praise', 'No stock praise. Name something specific or say nothing.');
    if (ctx.tone === 'plain' && (emojiCount(turn) > 0 || r.type === 'playful')) soft('plain', 'This applicant asked for plain: no jokes or emoji.');
    if (ctx.serious && (r.type === 'playful' || emojiCount(turn) > 0)) soft('serious', 'Serious moment: no humour and no emoji.');
    if ((r.type === 'playful' || r.type === 'surprised') && ctx.past.slice(-1)[0]?.reaction && /playful|surprised/.test(ctx.past.slice(-1)[0]!.reaction!)) {
      // Two jokes in a row is a bit; the second one lands worse.
      soft('streak', 'Do not make a joke on two turns in a row.');
    }
    for (const p of ctx.past) if (p.reaction && similarity(r.text, p.reaction) >= 0.6) soft('rrepeat', 'That reaction repeats an earlier one.');
  }
  if (emojiCount(turn) > 1) soft('emoji', 'At most one emoji in a turn.');
  else if (emojiCount(turn) === 1 && ctx.past.slice(-2).some((p) => emojiCount(`${p.reaction ?? ''} ${p.question}`) > 0)) soft('emoji', 'No emoji when you used one in the last two turns.');
  return out;
};

/** Turns the model's JSON into a Draft, or null when it is unusable. Only parsing and shape, not quality. */
export const parseDraft = (raw: string): (Draft & { spec: { format: string; raw: Record<string, unknown> } }) | null => {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!j || typeof j.question !== 'string') return null;
  let reaction: Reaction | null = null;
  const r = j.reaction as { type?: unknown; text?: unknown } | null | undefined;
  if (r && typeof r === 'object' && typeof r.text === 'string' && r.text.trim()) {
    reaction = { type: (REACTION_TYPES as readonly string[]).includes(r.type as string) ? (r.type as ReactionType) : 'curious', text: r.text.trim() };
  }
  const shows = Array.isArray(j.shows) ? [...new Set((j.shows as unknown[]).filter((c): c is Criterion => (CRITERIA as readonly string[]).includes(c as string)))] : [];
  return { reaction, question: j.question.trim(), mode: j.mode === 'follow_up' ? 'follow_up' : 'new', shows, spec: { format: typeof j.format === 'string' ? j.format : 'text', raw: j } };
};

export const describe = (ps: Problem[]) => ps.map((p) => p.message);
export type { Spec };
