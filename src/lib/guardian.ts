import crypto from 'node:crypto';
import { config } from '../config.js';
import { ageOn } from './age.js';
import { hashToken } from './tokens.js';

/** Bump when the wording changes, so each confirmation records exactly what was agreed to. */
export const CONSENT_TEXT_VERSION = 'v1';

// Placeholder wording until counsel and the safeguarding lead approve the final text (docs/SAFEGUARDING-ROLES.md).
export const CONSENT_TEXT = [
  'TeenovateX is a community where young people learn and build projects together. Members are 13 and over.',
  'By confirming, you agree that your child may create a TeenovateX account and take part in the community.',
  'We collect only what the programme needs. Application answers are read by our team and, to help the team, by an AI assistant.',
  'You can withdraw this confirmation at any time using the link in the email we sent you.',
];

export const needsGuardian = (birthDate: Date) => ageOn(birthDate) < config.guardianAgeBelow;

export const newConsentToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
};
