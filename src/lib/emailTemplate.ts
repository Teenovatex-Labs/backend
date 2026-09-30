// Shared HTML shell for every Resend email — same header, mascot, and
// footer everywhere so a verification code and a password reset still
// feel like the same product. Uses real hosted PNGs (not the site's SVGs)
// because Gmail/Outlook don't reliably render inline SVG.
const SITE_URL = process.env.SITE_URL ?? 'https://www.teenovatex.org';
const asset = (path: string) => `${SITE_URL}${path}`;

export function renderEmailShell({
  preheader,
  eyebrow,
  heading,
  bodyHtml,
  code,
  ctaLabel,
  ctaHref,
  footerNote,
}: {
  /** Hidden preview text most clients show next to the subject line. */
  preheader: string;
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  code?: string;
  ctaLabel: string;
  ctaHref: string;
  footerNote: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#fff9eb;font-family:Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff9eb;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#fff9eb;">
        <tr>
          <td align="center" style="padding-bottom:24px;">
            <img src="${asset('/assets/logo-long5.png')}" alt="TeenovateX" height="32" style="height:32px;width:auto;display:block;">
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid #262822;border-radius:10px;box-shadow:6px 6px 0 #f3aac7;overflow:hidden;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="background:#f5e89e;padding:28px 24px 20px;">
                  <img src="${asset('/assets/logo-burgundy.png')}" alt="" width="64" style="width:64px;height:auto;display:block;">
                </td>
              </tr>
              <tr>
                <td style="padding:28px 32px 8px;">
                  <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8d355b;">${eyebrow}</p>
                  <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;letter-spacing:-0.02em;color:#262822;">${heading}</h1>
                  <div style="font-size:15px;line-height:1.7;color:#5c6055;">${bodyHtml}</div>
                </td>
              </tr>
              ${
                code
                  ? `<tr>
                <td align="center" style="padding:8px 32px 4px;">
                  <div style="display:inline-block;background:#fff9eb;border:1px solid #262822;border-radius:8px;padding:18px 28px;font-size:34px;font-weight:700;letter-spacing:0.35em;color:#262822;">
                    ${code}
                  </div>
                  <p style="margin:10px 0 0;font-size:12px;color:#5c6055;">Expires in 10 minutes. Don&rsquo;t share this with anyone — not even us.</p>
                </td>
              </tr>`
                  : ''
              }
              <tr>
                <td align="center" style="padding:24px 32px 8px;">
                  <p style="margin:0 0 12px;font-size:12px;color:#5c6055;">Code acting shy? Use this link instead:</p>
                  <a href="${ctaHref}" style="display:inline-block;background:#262822;color:#fff9eb;text-decoration:none;font-weight:600;font-size:14px;padding:13px 22px;border-radius:6px;">${ctaLabel} ↗</a>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 32px 28px;">
                  <p style="margin:0;font-size:12px;color:#5c6055;">${footerNote}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 8px;">
            <p style="margin:0;font-size:11px;color:#5c6055;">TeenovateX Labs — a youth-led home for teenagers building things.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
