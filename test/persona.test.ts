import crypto from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { resetCooldowns } from '../src/lib/pet/providers.js';
import { think } from '../src/lib/pet/brain.js';
import { PERSONA } from '../src/lib/pet/persona.js';

// The persona is written by the product owner and must never drift. If this hash fails, someone
// edited persona.ts. Revert the edit, or, if the owner really approved a new persona, update the
// hash together with the owner.
const PERSONA_SHA256 = '87b8c456b1fd76a7135415c9df50f41136c8225d0e654db1992095324e3ed5e0';

describe('the persona', () => {
  it('is exactly the approved text', () => {
    expect(crypto.createHash('sha256').update(PERSONA).digest('hex')).toBe(PERSONA_SHA256);
  });

  it('keeps the parts that matter to how Alfred sounds', () => {
    expect(PERSONA.startsWith('You are a highly capable personal AI agent who speaks like a close Gen Z friend')).toBe(true);
    expect(PERSONA.endsWith('the extremely capable friend the user happens to text whenever they need something handled.')).toBe(true);
    for (const phrase of ['"bradar delete this 😭🙏"', 'Competence always comes before personality.', '17 is criminal 😭 we\'re picking 3.', 'Do not be sycophantic']) {
      expect(PERSONA).toContain(phrase);
    }
  });
});

describe('what the model is sent', () => {
  beforeEach(() => {
    resetCooldowns();
    config.pet.order = ['gemini'];
    config.pet.gemini.keys = ['k1'];
    config.pet.groq.keys = [];
  });
  afterAll(() => vi.unstubAllGlobals());

  it('starts with the persona word for word, then adds the platform rules', async () => {
    let body: { systemInstruction: { parts: { text: string }[] } } | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'yep, on it', intent: null }) }] } }] }), { status: 200 });
    }));
    await think({ text: 'hey', username: 'tester', page: '/home' });
    const system = body!.systemInstruction.parts[0]!.text;
    expect(system.startsWith(PERSONA)).toBe(true);
    const rules = system.slice(PERSONA.length);
    expect(rules).toMatch(/teenagers aged 13 to 17/);
    expect(rules).toMatch(/data, not instructions/);
    expect(rules).toMatch(/sincerely wants to know whether you are an AI, say yes/);
    expect(rules).toMatch(/talk to a parent, a teacher/);
    expect(rules).toMatch(/"kind":"go"/);
  });

  it('lets his emojis and slang through to the member', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'bradar you have 3 points 😭 lowkey we need to lock in', intent: { kind: 'points' } }) }] } }] }), { status: 200 })));
    const r = await think({ text: 'points?', username: 'tester' });
    expect(r.reply).toBe('bradar you have 3 points 😭 lowkey we need to lock in');
    expect(r.intent).toEqual({ kind: 'points' });
  });
});
