import crypto from 'node:crypto';
import { config } from '../config.js';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../db.js';
import {
  createSession,
  hashToken,
  verifyRefreshToken,
  generateAccessToken,
  generateRefreshToken,
  deriveRefreshToken,
  generateResetToken,
  verifyResetToken,
} from '../lib/tokens.js';
import { recordDailyLogin } from '../lib/streak.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../lib/resend.js';
import {
  generateVerificationCode,
  hashVerificationCode,
  verificationExpiry,
  isVerificationExpired,
  isWithinResendCooldown,
  secondsUntilResendAllowed,
  MAX_VERIFICATION_ATTEMPTS,
} from '../lib/verification.js';
import { MIN_AGE, ageOn, toDbDate } from '../lib/age.js';

const googleClient = new OAuth2Client(config.googleClientId);

const issueAndSendVerificationCode = async (userId: string, email: string): Promise<void> => {
  const code = generateVerificationCode();
  await prisma.user.update({
    where: { id: userId },
    data: {
      verification_code_hash: hashVerificationCode(code, userId),
      verification_code_expires_at: verificationExpiry(),
      verification_attempts: 0,
    },
  });
  await sendVerificationEmail(email, code);
};

export const register = async (req: Request, res: Response): Promise<void> => {
  const { full_name, username, email, password, birth_date, timezone } = req.body as {
    full_name: string;
    username: string;
    email: string;
    password: string;
    birth_date: string;
    timezone?: string;
  };

  // Checked before anything is stored: an under-13 sign-up leaves no trace.
  if (ageOn(birth_date) < MIN_AGE) {
    res.status(403).json({
      error: `TeenovateX is for ages ${MIN_AGE} and up. Come back when you're ${MIN_AGE}!`,
      code: 'AGE_TOO_YOUNG',
    });
    return;
  }

  const existingByEmail = await prisma.user.findUnique({ where: { email } });

  if (existingByEmail?.email_verified) {
    // A real, active account already sits on this email. If it was set up
    // through Google and never got a password, say so specifically —
    // otherwise someone who forgot they'd used Google before just sees a
    // generic wall and can't tell how to get in.
    if (existingByEmail.google_id && !existingByEmail.password_hash) {
      res.status(400).json({
        error: 'This email is linked to a Google account — continue with Google instead',
        code: 'GOOGLE_ACCOUNT_EXISTS',
      });
      return;
    }
    res.status(400).json({ error: 'Email already in use', code: 'DUPLICATE' });
    return;
  }

  // An unverified row from an earlier, abandoned signup attempt — refresh
  // it and resend the code rather than blocking the retry as a duplicate.
  if (existingByEmail) {
    const usernameTaken = await prisma.user.findFirst({
      where: { username, NOT: { id: existingByEmail.id } },
    });
    if (usernameTaken) {
      res.status(400).json({ error: 'Username already in use', code: 'DUPLICATE' });
      return;
    }

    const password_hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.update({
      where: { id: existingByEmail.id },
      data: { full_name, username, password_hash, birth_date: toDbDate(birth_date), timezone },
    });
    await issueAndSendVerificationCode(user.id, user.email);

    res.status(201).json({
      message: 'Check your email for a verification code',
      email: user.email,
      require_verification: true,
    });
    return;
  }

  const usernameTaken = await prisma.user.findUnique({ where: { username } });
  if (usernameTaken) {
    res.status(400).json({ error: 'Username already in use', code: 'DUPLICATE' });
    return;
  }

  const password_hash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { full_name, username, email, password_hash, birth_date: toDbDate(birth_date), timezone, settings: { create: {} } },
  });
  await issueAndSendVerificationCode(user.id, user.email);

  res.status(201).json({
    message: 'Check your email for a verification code',
    email: user.email,
    require_verification: true,
  });
};

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  const { email, code } = req.body as { email: string; code: string };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(400).json({ error: 'Invalid email or code', code: 'INVALID_CODE' });
    return;
  }
  if (user.email_verified) {
    res.status(400).json({ error: 'Email already verified', code: 'ALREADY_VERIFIED' });
    return;
  }
  if (!user.verification_code_hash || isVerificationExpired(user.verification_code_expires_at)) {
    res.status(400).json({ error: 'Code expired — request a new one', code: 'CODE_EXPIRED' });
    return;
  }
  if (user.verification_attempts >= MAX_VERIFICATION_ATTEMPTS) {
    res.status(429).json({ error: 'Too many attempts — request a new code', code: 'TOO_MANY_ATTEMPTS' });
    return;
  }

  if (hashVerificationCode(code, user.id) !== user.verification_code_hash) {
    await prisma.user.update({
      where: { id: user.id },
      data: { verification_attempts: { increment: 1 } },
    });
    res.status(400).json({ error: 'Incorrect code', code: 'INVALID_CODE' });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      email_verified: true,
      verification_code_hash: null,
      verification_code_expires_at: null,
      verification_attempts: 0,
    },
  });

  await recordDailyLogin(user);

  const tokens = await createSession(user.id, req);
  res.json({
    ...tokens,
    user: { id: user.id, username: user.username, avatar_url: user.avatar_url },
  });
};

export const resendVerification = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body as { email: string };

  const user = await prisma.user.findUnique({ where: { email } });
  // Same generic response whether or not the account exists, so this can't
  // be used to enumerate emails.
  if (!user || user.email_verified) {
    res.json({ message: 'If that email needs verifying, a new code has been sent' });
    return;
  }

  if (isWithinResendCooldown(user.verification_code_expires_at)) {
    res.status(429).json({
      error: 'Please wait before requesting another code',
      code: 'RESEND_COOLDOWN',
      retry_after_seconds: secondsUntilResendAllowed(user.verification_code_expires_at),
    });
    return;
  }

  await issueAndSendVerificationCode(user.id, user.email);
  res.json({ message: 'If that email needs verifying, a new code has been sent' });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email: string; password: string };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    return;
  }
  if (!user.password_hash) {
    res.status(401).json({
      error: 'This account uses Google sign-in — continue with Google instead',
      code: 'GOOGLE_ACCOUNT',
    });
    return;
  }
  if (!(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    return;
  }
  if (!user.email_verified) {
    res.status(403).json({
      error: 'Verify your email before logging in',
      code: 'EMAIL_NOT_VERIFIED',
      email: user.email,
    });
    return;
  }

  await recordDailyLogin(user);

  const tokens = await createSession(user.id, req);

  res.json({
    ...tokens,
    user: { id: user.id, username: user.username, avatar_url: user.avatar_url },
  });
};

/**
 * How long the previous refresh token is still honoured after a rotation. It covers a response that
 * never arrived (the page reloaded mid-request, the connection dropped) and two tabs refreshing
 * together. In that window the member is simply handed the current token again.
 */
export const REFRESH_GRACE_MS = 10 * 60_000;

export const refresh = async (req: Request, res: Response): Promise<void> => {
  const { refresh_token } = req.body as { refresh_token: string };

  let decoded: { userId: string; type: string };
  try {
    decoded = verifyRefreshToken(refresh_token);
  } catch {
    res.status(401).json({ error: 'Invalid refresh token', code: 'INVALID_TOKEN' });
    return;
  }

  if (decoded.type !== 'refresh') {
    res.status(401).json({ error: 'Invalid token type', code: 'INVALID_TOKEN' });
    return;
  }

  const token_hash = hashToken(refresh_token);
  const now = new Date();

  // Every refresh replaces the refresh token, so a stolen one only works until the real owner's next
  // refresh. The updateMany is the atomic step: of several simultaneous requests with the same token
  // exactly one performs the rotation; the others fall through to the "just replaced" case below.
  const session = await prisma.session.findUnique({ where: { token_hash } });
  if (session) {
    const rotation = session.rotation + 1;
    const next = deriveRefreshToken({ id: session.id, user_id: session.user_id, rotation, rotated_at: now });
    const rotated = await prisma.session.updateMany({
      where: { id: session.id, token_hash },
      data: { token_hash: hashToken(next), prev_token_hash: token_hash, rotation, rotated_at: now, last_active: now },
    });
    if (rotated.count === 1) {
      res.json({ access_token: generateAccessToken(decoded.userId), refresh_token: next });
      return;
    }
  }

  const previous = await prisma.session.findUnique({ where: { prev_token_hash: token_hash } });
  if (previous?.rotated_at && now.getTime() - previous.rotated_at.getTime() <= REFRESH_GRACE_MS) {
    // The same current token, every time: safe for lost responses and for several tabs.
    res.json({ access_token: generateAccessToken(decoded.userId), refresh_token: deriveRefreshToken({ ...previous, rotated_at: previous.rotated_at }) });
    return;
  }
  if (previous) {
    // An already-replaced token turning up long after the fact means it was copied. End that session.
    await prisma.session.delete({ where: { id: previous.id } });
    res.status(401).json({ error: 'Session expired. Please sign in again.', code: 'SESSION_EXPIRED' });
    return;
  }
  res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' });
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body as { email: string };
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    if (isWithinResendCooldown(user.reset_code_expires_at)) {
      res.status(429).json({
        error: 'Please wait before requesting another code',
        code: 'RESEND_COOLDOWN',
        retry_after_seconds: secondsUntilResendAllowed(user.reset_code_expires_at),
      });
      return;
    }

    const code = generateVerificationCode();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        reset_code_hash: hashVerificationCode(code, user.id),
        reset_code_expires_at: verificationExpiry(),
        reset_attempts: 0,
      },
    });
    const token = generateResetToken(user.id);
    await sendPasswordResetEmail(email, code, token);
  }

  // Same response whether or not the account exists — no email enumeration.
  res.json({ message: 'If that email is registered, a code has been sent' });
};

export const verifyResetCode = async (req: Request, res: Response): Promise<void> => {
  const { email, code } = req.body as { email: string; code: string };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.reset_code_hash || isVerificationExpired(user.reset_code_expires_at)) {
    res.status(400).json({ error: 'Invalid email or code', code: 'INVALID_CODE' });
    return;
  }
  if (user.reset_attempts >= MAX_VERIFICATION_ATTEMPTS) {
    res.status(429).json({ error: 'Too many attempts — request a new code', code: 'TOO_MANY_ATTEMPTS' });
    return;
  }
  if (hashVerificationCode(code, user.id) !== user.reset_code_hash) {
    await prisma.user.update({ where: { id: user.id }, data: { reset_attempts: { increment: 1 } } });
    res.status(400).json({ error: 'Incorrect code', code: 'INVALID_CODE' });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { reset_code_hash: null, reset_code_expires_at: null, reset_attempts: 0 },
  });

  // Same short-lived token the email link uses, so both paths converge on
  // the one resetPassword endpoint below.
  res.json({ token: generateResetToken(user.id) });
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const { token, new_password } = req.body as { token: string; new_password: string };

  let decoded: { userId: string; type: string };
  try {
    decoded = verifyResetToken(token);
  } catch {
    res.status(400).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
    return;
  }

  if (decoded.type !== 'reset') {
    res.status(400).json({ error: 'Invalid token type', code: 'INVALID_TOKEN' });
    return;
  }

  const password_hash = await bcrypt.hash(new_password, 12);
  await prisma.user.update({ where: { id: decoded.userId }, data: { password_hash } });
  await prisma.session.deleteMany({ where: { user_id: decoded.userId } });

  res.json({ message: 'Password updated successfully' });
};

export const googleAuth = async (req: Request, res: Response): Promise<void> => {
  const { id_token } = req.body as { id_token: string };

  if (!config.googleClientId) {
    res.status(500).json({ error: 'Google sign-in is not configured', code: 'GOOGLE_NOT_CONFIGURED' });
    return;
  }

  let payload: { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string } | undefined;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: config.googleClientId,
    });
    payload = ticket.getPayload();
  } catch {
    res.status(401).json({ error: 'Invalid Google token', code: 'INVALID_TOKEN' });
    return;
  }

  if (!payload?.email) {
    res.status(401).json({ error: 'Invalid Google token', code: 'INVALID_TOKEN' });
    return;
  }

  // Google includes this claim; only a handful of legacy/edge IdP cases
  // ever send it as false. Treat that as "can't vouch for this address" —
  // fall through to creating a fresh account rather than linking onto (and
  // trusting) an existing row by email match.
  const googleVerifiedEmail = payload.email_verified !== false;

  let user = await prisma.user.findUnique({ where: { google_id: payload.sub } });

  if (!user) {
    const existingByEmail = googleVerifiedEmail
      ? await prisma.user.findUnique({ where: { email: payload.email } })
      : null;
    if (existingByEmail) {
      // Nobody had confirmed this email yet — the row could be a stranger's
      // abandoned signup, or someone who registered this address first
      // hoping to hijack whoever actually owns it once they showed up.
      // Google's OAuth just proved real ownership, so any password already
      // sitting on the row can't be trusted: wipe it (and any pending
      // verification code) rather than leave a stranger's password valid
      // on what is now this person's account.
      const hadUnverifiedCredentials = !existingByEmail.email_verified;

      user = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          google_id: payload.sub,
          avatar_url: existingByEmail.avatar_url ?? payload.picture ?? null,
          // Google already verified this address, even if a prior
          // email/password signup attempt here never finished verifying.
          email_verified: true,
          ...(hadUnverifiedCredentials && {
            password_hash: null,
            verification_code_hash: null,
            verification_code_expires_at: null,
            verification_attempts: 0,
          }),
        },
      });
    } else {
      // Placeholder only: the member is made to pick a real username before entering the app.
      const username = `user_${crypto.randomBytes(5).toString('hex')}`;
      user = await prisma.user.create({
        data: {
          full_name: payload.name ?? payload.email,
          username,
          username_set: false,
          email: payload.email,
          google_id: payload.sub,
          avatar_url: payload.picture ?? null,
          email_verified: true,
          settings: { create: {} },
        },
      });
    }
  }

  await recordDailyLogin(user);

  const tokens = await createSession(user.id, req);

  res.json({
    ...tokens,
    user: { id: user.id, username: user.username, avatar_url: user.avatar_url },
  });
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { refresh_token?: string };
  if (body.refresh_token) {
    const token_hash = hashToken(body.refresh_token);
    await prisma.session.deleteMany({ where: { token_hash } });
  }
  res.json({ message: 'Logged out' });
};
