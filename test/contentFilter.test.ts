import { describe, expect, it } from 'vitest';
import { accountAgeDays, screenText } from '../src/lib/contentFilter.js';

const old = { accountAgeDays: 30 };
const brandNew = { accountAgeDays: 0 };
const code = (text: string, opts = old) => {
  const r = screenText(text, opts);
  return r.ok ? 'ok' : r.code;
};

describe('content filter', () => {
  it('lets ordinary teenage chatter through', () => {
    for (const t of [
      'Just shipped my first game, would love feedback!',
      'Anyone else stuck on CSS grid? I tried grid-template-columns: repeat(3, 1fr).',
      'I was born on 2010-04-12 and started coding at 11.',
      'Check out teenovatex.org/labs for ideas',
      'My Telegram bot finally works',
    ]) expect(code(t, brandNew)).toBe('ok');
  });

  it('keeps contact details private', () => {
    expect(code('call me on 0803 555 1234')).toBe('PERSONAL_INFO');
    expect(code('text +1 (415) 555-0199 ok')).toBe('PERSONAL_INFO');
    expect(code('mail me at sam.k@example.com')).toBe('PERSONAL_INFO');
  });

  it('stops requests to move the chat off the platform', () => {
    expect(code('dm me on snap')).toBe('OFF_PLATFORM');
    expect(code('add me on insta')).toBe('OFF_PLATFORM');
    expect(code('my snap is cool_kid_22')).toBe('OFF_PLATFORM');
    expect(code('hit me up on whatsapp')).toBe('OFF_PLATFORM');
  });

  it('blocks links from brand-new accounts only, but never our own domain', () => {
    expect(code('see https://evil.example.com/x', brandNew)).toBe('LINKS_NOT_ALLOWED');
    expect(code('go to www.cool-site.io', brandNew)).toBe('LINKS_NOT_ALLOWED');
    expect(code('see https://evil.example.com/x', old)).toBe('ok');
    expect(code('read teenovatex.org/learn', brandNew)).toBe('ok');
    expect(screenText('https://x.example.com', { accountAgeDays: 0, allowLinks: true }).ok).toBe(true);
  });

  it('blocks profanity even with simple disguises', () => {
    expect(code('this is shit')).toBe('ABUSIVE_LANGUAGE');
    expect(code('what a b1tch')).toBe('ABUSIVE_LANGUAGE');
    expect(code('sh!t')).toBe('ABUSIVE_LANGUAGE');
  });

  it('does not block innocent words that merely contain a bad one', () => {
    for (const t of ['I love Scunthorpe', 'a classic assessment', 'the shiitake mushrooms', 'a dickens novel']) expect(code(t)).toBe('ok');
  });

  it('blocks abuse aimed at others', () => {
    expect(code('kys')).toBe('ABUSIVE_LANGUAGE');
    expect(code('just kill yourself')).toBe('ABUSIVE_LANGUAGE');
    expect(code('go die')).toBe('ABUSIVE_LANGUAGE');
  });

  it('answers self-harm with support, not a scolding', () => {
    for (const t of ['I want to die', 'thinking about suicide', 'I might hurt myself']) {
      const r = screenText(t, old);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('SELF_HARM');
        expect(r.message).toMatch(/988/);
        expect(r.message).not.toMatch(/inappropriate|violat/i);
      }
    }
  });

  it('counts whole days since an account was made', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    expect(accountAgeDays(new Date('2026-03-10T00:00:00Z'), now)).toBe(0);
    expect(accountAgeDays(new Date('2026-03-07T11:00:00Z'), now)).toBe(3);
  });
});
