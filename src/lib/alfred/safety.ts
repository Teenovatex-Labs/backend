// Applicants are young. If an answer suggests the person may be at risk of harm, nothing about it goes to an
// AI provider, Alfred drops the interview voice and gives a fixed, human-written reply, and staff are told.
// A keyword check misses things and also fires on harmless text; it is a safety net, never a classifier we
// trust. Staff read the flagged answer themselves. Wording and local resources must be approved by the
// safeguarding lead and counsel (docs/SAFEGUARDING-ROLES.md) before launch.

const PATTERNS: RegExp[] = [
  /\bsuicid/i,
  /\bkill(ing)?\s+(my\s*self|myself)\b/i,
  /\bend(ing)?\s+(my|it\s+all)\b.*\blife\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bdon'?t\s+want\s+to\s+(be\s+alive|live)\b/i,
  /\bself[\s-]?harm/i,
  /\bhurt(ing)?\s+(my\s*self|myself)\b/i,
  /\bcut(ting)?\s+(my\s*self|myself)\b/i,
  /\b(being\s+)?(abused|molested|raped)\b/i,
  /\bsomeone\s+is\s+(hurting|touching)\s+me\b/i,
];

export const isSensitive = (text: string) => PATTERNS.some((p) => p.test(text));

export const SAFETY_REPLY =
  'Thank you for telling us that. It sounds like things might be heavy right now, and that matters far more than any application. ' +
  'Please talk to an adult you trust, such as a parent, a relative, a teacher or a counsellor, today if you can. ' +
  'If you are in danger or think you might hurt yourself, contact your local emergency number straight away. ' +
  'A member of our team has been asked to look at your message with care. You do not have to answer anything else for now.';
