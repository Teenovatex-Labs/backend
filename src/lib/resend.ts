import { Resend } from 'resend';
import { renderEmailShell } from './emailTemplate.js';

// Signup verification + password reset codes go through Resend (not the
// Gmail SMTP transport in lib/email.ts). Defaults to Resend's own sandbox
// sender so this works with zero DNS setup; swap RESEND_FROM for a
// verified domain address for real deliverability.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM ?? 'TeenovateX Labs <onboarding@resend.dev>';
const SITE_URL = process.env.FRONTEND_URL ?? 'https://www.teenovatex.org';

const send = async (to: string, subject: string, html: string, devLabel: string, devExtra: string) => {
  if (!resend) {
    console.log(`[DEV] ${devLabel} for ${to}: ${devExtra}`);
    return;
  }
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) {
    console.error('Resend error:', error);
    throw new Error(`Failed to send ${devLabel.toLowerCase()} email`);
  }
};

export const sendVerificationEmail = async (email: string, code: string) => {
  const link = `${SITE_URL}/auth?mode=signup&verify_email=${encodeURIComponent(email)}&code=${code}`;
  const html = renderEmailShell({
    preheader: `${code} is your code — welcome to the comeback.`,
    eyebrow: 'One quick step',
    heading: 'Prove you&rsquo;re a human (a talented one).',
    bodyHtml: `
      <p style="margin:0 0 12px;">Somebody used this email to start becoming a Teenovator. If that was you — nice, let&rsquo;s finish the job.</p>
      <p style="margin:0;">Type the code below into the box that&rsquo;s awkwardly staring at you right now.</p>
    `,
    code,
    ctaLabel: 'Verify by link instead',
    ctaHref: link,
    footerNote: "Didn&rsquo;t sign up? Ignore this — someone just typoed their own email, and honestly, that's on them.",
  });
  await send(email, `${code} is your TeenovateX code`, html, 'Verification code', code);
};

export const sendPasswordResetEmail = async (email: string, code: string, resetToken: string) => {
  const link = `${SITE_URL}/auth/reset-password?token=${encodeURIComponent(resetToken)}`;
  const html = renderEmailShell({
    preheader: `${code} gets you back in. No drama.`,
    eyebrow: 'Password reset',
    heading: 'Forgot your password? Happens to the best of us.',
    bodyHtml: `
      <p style="margin:0 0 12px;">Even the person who built this platform forgets theirs sometimes (allegedly). Here's your way back in.</p>
      <p style="margin:0;">Enter this code where you requested the reset, and pick something you'll actually remember this time.</p>
    `,
    code,
    ctaLabel: 'Reset by link instead',
    ctaHref: link,
    footerNote: "Didn&rsquo;t ask for this? Your password is safe — just ignore this email and carry on being awesome.",
  });
  await send(email, `${code} — reset your TeenovateX password`, html, 'Password reset code', `${code} / ${link}`);
};
