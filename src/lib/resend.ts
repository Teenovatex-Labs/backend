import { Resend } from 'resend';

// Signup verification codes go through Resend (not the Gmail SMTP transport
// in lib/email.ts, which is only used for password-reset links). Defaults
// to Resend's own sandbox sender so this works with zero DNS setup; swap
// RESEND_FROM for a verified domain address once one exists.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
// Falls back to Resend's sandbox sender (works with zero DNS setup) if no
// verified domain is configured; set RESEND_FROM to an address on a
// verified domain for real deliverability.
const FROM = process.env.RESEND_FROM ?? 'TeenovateX Labs <onboarding@resend.dev>';

export const sendVerificationEmail = async (email: string, code: string) => {
  if (!resend) {
    console.log(`[DEV] Verification code for ${email}: ${code}`);
    return;
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: `${code} is your TeenovateX verification code`,
    html: `
      <div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#262822">
        <h2 style="color:#8d355b;margin-bottom:4px">Verify your email</h2>
        <p style="color:#5c6055">Enter this code to finish creating your TeenovateX account.</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:8px;background:#fff9eb;border:1px solid #262822;border-radius:8px;padding:20px;text-align:center;margin:20px 0">
          ${code}
        </div>
        <p style="color:#5c6055;font-size:13px">This code expires in <strong>10 minutes</strong>. If you didn't request this, you can ignore this email.</p>
      </div>
    `,
  });

  if (error) {
    console.error('Resend error:', error);
    throw new Error('Failed to send verification email');
  }
};
