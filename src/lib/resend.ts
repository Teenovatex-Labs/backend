import { config } from '../config.js';
import { Resend } from 'resend';
import { renderEmailShell } from './emailTemplate.js';

// Signup verification + password reset codes go through Resend (not the
// Gmail SMTP transport in lib/email.ts). Defaults to Resend's own sandbox
// sender so this works with zero DNS setup; swap RESEND_FROM for a
// verified domain address for real deliverability.
const resend = config.resend.apiKey ? new Resend(config.resend.apiKey) : null;
const FROM = config.resend.from;
// FRONTEND_URL is the CORS allow-list (can hold several origins), so links and
// assets in emails use their own single-origin settings.
const SITE_URL = config.siteUrl;
const APP_URL = config.appUrl;

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
  const link = `${APP_URL}/auth?mode=signup&verify_email=${encodeURIComponent(email)}&code=${code}`;
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
  const link = `${APP_URL}/auth/reset-password?token=${encodeURIComponent(resetToken)}`;
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

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const TOPIC_LABEL: Record<string, string> = {
  hello: 'Just saying hello',
  partner: 'Partnership',
  sponsor: 'Sponsorship',
  mentor: 'Mentoring',
  donate: 'Donation',
  press: 'Press',
  other: 'Something else',
};

export const sendContactMessage = async (msg: { name: string; email: string; topic: string; message: string }) => {
  const topic = TOPIC_LABEL[msg.topic] ?? TOPIC_LABEL.other;
  const inbox = config.contactTo;

  if (!resend || !inbox) {
    console.log(`[DEV] Contact message from ${msg.name} <${msg.email}> [${topic}]: ${msg.message}`);
    return;
  }

  const teamHtml = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;color:#262822;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8d355b;">${escapeHtml(topic)}</p>
      <h2 style="margin:0 0 16px;">${escapeHtml(msg.name)} wrote in</h2>
      <p style="margin:0 0 16px;white-space:pre-wrap;line-height:1.7;">${escapeHtml(msg.message)}</p>
      <p style="margin:0;font-size:13px;color:#5c6055;">Reply to this email to answer ${escapeHtml(msg.name)} directly (${escapeHtml(msg.email)}).</p>
    </div>`;

  const { error } = await resend.emails.send({
    from: FROM,
    to: inbox,
    replyTo: msg.email,
    subject: `[${topic}] ${msg.name} via teenovatex.org`,
    html: teamHtml,
  });
  if (error) {
    console.error('Resend error:', error);
    throw new Error('Failed to send contact message');
  }

  // The copy to the sender is a courtesy — the message is already delivered
  // to the team, so a failure here must not fail the request.
  const copyHtml = renderEmailShell({
    preheader: 'Got it. A real human will read this.',
    eyebrow: 'Message received',
    heading: `Thanks, ${escapeHtml(msg.name.split(' ')[0])}. It landed.`,
    bodyHtml: `
      <p style="margin:0 0 12px;">Your message reached the TeenovateX team. Someone will reply from this thread, usually within a few days.</p>
      <p style="margin:0;white-space:pre-wrap;border-left:3px solid #f3aac7;padding-left:12px;color:#262822;">${escapeHtml(msg.message)}</p>
    `,
    ctaLabel: 'Back to the site',
    ctaHref: SITE_URL,
    footerNote: 'You are getting this because this address was used on the contact form at teenovatex.org.',
  });
  const copy = await resend.emails.send({ from: FROM, to: msg.email, subject: 'We got your message', html: copyHtml });
  if (copy.error) console.error('Resend confirmation error:', copy.error);
};
