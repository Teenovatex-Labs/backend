// The first line of defence for anything a member writes in public (posts, comments, later DMs).
//
// It is deliberately strict about the things that put teenagers at risk (contact details, links
// from brand-new accounts, off-platform move-the-chat requests) and gentle about everything else.
// It is a filter, not a moderator: anything that gets past it can still be reported, and every
// rejection tells the writer why in plain words so they can fix it and try again.

export type ScreenCode = 'PERSONAL_INFO' | 'OFF_PLATFORM' | 'LINKS_NOT_ALLOWED' | 'ABUSIVE_LANGUAGE' | 'SELF_HARM';
export type ScreenResult = { ok: true } | { ok: false; code: ScreenCode; message: string };

/** Accounts younger than this can't post links, which is where most spam and grooming starts. */
export const LINK_MIN_ACCOUNT_DAYS = 3;

const PROFANITY = [
  'fuck', 'fucking', 'fucker', 'shit', 'shitty', 'bitch', 'bastard', 'asshole', 'dickhead', 'cunt', 'prick', 'slut', 'whore',
];
// Slurs and other terms the team wants blocked live in the environment, not in source control.
const extra = (process.env.EXTRA_BLOCKED_WORDS ?? '')
  .split(',')
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean);

const ABUSE_PHRASES = [/\bkys\b/i, /\bkill\s+your\s*self\b/i, /\bgo\s+die\b/i, /\bnobody\s+(likes|wants)\s+you\b/i];
const SELF_HARM = [
  /\b(kill|hurt|harm)\s+my\s*self\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bend\s+(it\s+all|my\s+life)\b/i,
  /\bsuicid(e|al)\b/i,
  /\bself[\s-]?harm\b/i,
];

const PHONE = /(?:\+?\d[\s().-]{0,2}){9,}/;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}/i;
// "dm me on snap", "add me on insta", "text me": asks to move the conversation somewhere unmonitored.
const OFF_PLATFORM =
  /\b(add|dm|text|message|msg|hmu|hit|contact|find)\s+(me|us)\b.{0,25}\b(snap|snapchat|insta|instagram|whatsapp|telegram|discord|kik|tiktok|signal|facetime|skype)\b/i;
const HANDLE_ON_PLATFORM = /\b(snap|snapchat|insta|instagram|whatsapp|telegram|kik)\s*(?:is|:|-)\s*@?[a-z0-9._]{3,}/i;
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|me|gg|xyz|app|dev|ly|tv|link)\b(?:\/\S*)?/i;
const OWN_DOMAIN = /teenovatex\.org(?:\/\S*)?/gi;

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[@4]/g, 'a')
    .replace(/[3]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/\$/g, 's')
    .replace(/[^a-z\s]/g, '');

const hasBlockedWord = (text: string) => {
  const words = new Set(normalise(text).split(/\s+/));
  return [...PROFANITY, ...extra].some((w) => words.has(w));
};

export const SELF_HARM_MESSAGE =
  "It sounds like you're carrying something heavy. Please talk to someone you trust, or reach a crisis line (in the US, call or text 988; elsewhere, findahelpline.com lists one near you). You matter here, and we didn't post this so you can get support first.";

export function screenText(text: string, opts: { accountAgeDays: number; allowLinks?: boolean }): ScreenResult {
  if (SELF_HARM.some((r) => r.test(text))) return { ok: false, code: 'SELF_HARM', message: SELF_HARM_MESSAGE };

  if (ABUSE_PHRASES.some((r) => r.test(text)) || hasBlockedWord(text)) {
    return { ok: false, code: 'ABUSIVE_LANGUAGE', message: 'Please keep it kind and clean. Rewrite that without the harsh language and try again.' };
  }

  if (EMAIL.test(text) || PHONE.test(text.replace(/\d{4}-\d{2}-\d{2}/g, ''))) {
    return { ok: false, code: 'PERSONAL_INFO', message: 'Keep phone numbers, emails and addresses private. Share your work, not your details.' };
  }

  if (OFF_PLATFORM.test(text) || HANDLE_ON_PLATFORM.test(text)) {
    return { ok: false, code: 'OFF_PLATFORM', message: "Let's keep the conversation here on TeenovateX, where it's safe. Please don't ask people to move to other apps." };
  }

  if (LINK.test(text.replace(OWN_DOMAIN, '')) && !opts.allowLinks && opts.accountAgeDays < LINK_MIN_ACCOUNT_DAYS) {
    return { ok: false, code: 'LINKS_NOT_ALLOWED', message: `Links unlock ${LINK_MIN_ACCOUNT_DAYS} days after you join. Keep it to text for now.` };
  }

  return { ok: true };
}

/** Whole days since the account was created. */
export const accountAgeDays = (createdAt: Date, now: Date = new Date()) =>
  Math.floor((now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
