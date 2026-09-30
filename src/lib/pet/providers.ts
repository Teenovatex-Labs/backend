import { config } from '../../config.js';

// Talks to the free AI providers. Design goals, in order: never leak a key, never hang, and keep
// working when one key or provider is rate-limited by moving on to the next.

export type ProviderName = 'gemini' | 'groq';
export type Generated = { text: string; provider: ProviderName };
type FetchLike = typeof fetch;

export class AllProvidersFailed extends Error {
  constructor(public readonly attempts: number) {
    super('No AI provider could answer');
  }
}

const TIMEOUT_MS = 8_000;

/** Keys that recently failed are skipped until their cooldown ends. Keyed by provider + position, never by the key itself. */
const cooldowns = new Map<string, number>();
export const resetCooldowns = () => cooldowns.clear();
export const isCoolingDown = (id: string, now = Date.now()) => (cooldowns.get(id) ?? 0) > now;
const cool = (id: string, ms: number, now = Date.now()) => cooldowns.set(id, now + ms);

const retryAfterMs = (res: Response) => {
  const raw = Number(res.headers.get('retry-after'));
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 600) * 1000 : 60_000;
};

async function post(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type Prompt = { system: string; user: string };

async function askGemini(fetchImpl: FetchLike, key: string, model: string, p: Prompt): Promise<Response> {
  return post(
    fetchImpl,
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': key },
    {
      systemInstruction: { parts: [{ text: p.system }] },
      contents: [{ role: 'user', parts: [{ text: p.user }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 320, responseMimeType: 'application/json' },
    }
  );
}

async function askGroq(fetchImpl: FetchLike, key: string, model: string, p: Prompt): Promise<Response> {
  return post(
    fetchImpl,
    'https://api.groq.com/openai/v1/chat/completions',
    { Authorization: `Bearer ${key}` },
    {
      model,
      messages: [
        { role: 'system', content: p.system },
        { role: 'user', content: p.user },
      ],
      temperature: 0.4,
      max_tokens: 320,
      response_format: { type: 'json_object' },
    }
  );
}

const extract = (provider: ProviderName, data: unknown): string | null => {
  try {
    const d = data as { candidates?: { content?: { parts?: { text?: string }[] } }[]; choices?: { message?: { content?: string } }[] };
    const text = provider === 'gemini' ? d.candidates?.[0]?.content?.parts?.[0]?.text : d.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text : null;
  } catch {
    return null;
  }
};

/**
 * Tries every configured provider in order, and every key within a provider, until one gives back
 * text. `accept` lets the caller reject an unusable answer (bad JSON), in which case the next key
 * or provider is tried instead.
 */
export async function generate(prompt: Prompt, accept: (text: string) => boolean, fetchImpl: FetchLike = fetch): Promise<Generated> {
  const { pet } = config;
  let attempts = 0;

  for (const provider of pet.order) {
    const { keys, model } = pet[provider];
    for (const [i, key] of keys.entries()) {
      const id = `${provider}:${i}`;
      if (isCoolingDown(id)) continue;
      attempts++;
      try {
        const res = provider === 'gemini' ? await askGemini(fetchImpl, key, model, prompt) : await askGroq(fetchImpl, key, model, prompt);
        if (res.status === 429) { cool(id, retryAfterMs(res)); continue; }
        if (res.status === 401 || res.status === 403) { cool(id, 60 * 60_000); continue; } // a bad or revoked key
        if (res.status >= 500) { cool(id, 20_000); continue; }
        if (!res.ok) continue; // our request was wrong for this provider; try the next
        const text = extract(provider, await res.json().catch(() => null));
        if (text && accept(text)) return { text, provider };
      } catch {
        cool(id, 20_000); // timeout or network error
      }
    }
  }
  throw new AllProvidersFailed(attempts);
}

/** True when at least one key is configured for a provider we are allowed to use. */
export const hasProviders = () => config.pet.order.some((p) => config.pet[p].keys.length > 0);
