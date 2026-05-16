import nodemailer from 'nodemailer';



const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export const sendPasswordResetEmail = async (email: string, token: string) => {
  const url = `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/reset-password?token=${token}`;

  if (!process.env.GMAIL_USER) {
    console.log(`[DEV] Password reset email would be sent to ${email} (configure GMAIL_USER to send emails)`);
    return;
  }

  await transporter.sendMail({
    from: `"TX Platform" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Reset your TX password',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#2AABEE">Reset your TX password</h2>
        <p>Click below to reset your password. This link expires in <strong>15 minutes</strong>.</p>
        <a href="${url}" style="display:inline-block;padding:12px 24px;background:#2AABEE;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
          Reset Password
        </a>
        <p style="color:#888;font-size:12px;margin-top:24px">If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
};
