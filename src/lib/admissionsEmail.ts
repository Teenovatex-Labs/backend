import { config } from '../config.js';
import { renderEmailShell } from './emailTemplate.js';
import { send } from './resend.js';

const APP_URL = config.appUrl;

export const sendApplicationLink = (email: string, token: string) => {
  const link = `${APP_URL}/apply/resume?token=${token}`;
  return send(
    email,
    'Your TeenovateX application link',
    renderEmailShell({
      preheader: 'Pick up your application where you left off.',
      eyebrow: 'Your application',
      heading: 'Here&rsquo;s your way back in.',
      bodyHtml: '<p style="margin:0 0 12px;">Use the button below to continue or check your application. The link works for 14 days and is only for you, so please don&rsquo;t share it.</p>',
      ctaLabel: 'Open my application',
      ctaHref: link,
      footerNote: 'If you didn&rsquo;t start an application, you can ignore this email.',
    }),
    'Application link',
    link
  );
};

export const sendApplicationReceived = (email: string, reference: string) =>
  send(
    email,
    `We got your application (${reference})`,
    renderEmailShell({
      preheader: 'Submitted. This is not an acceptance yet.',
      eyebrow: 'Application received',
      heading: 'Submitted. Nice work.',
      bodyHtml: `<p style="margin:0 0 12px;">Your reference is <strong>${reference}</strong>. Submitting is not the same as being accepted: our team reviews every application, and results are released together on the announced decision date.</p>`,
      ctaLabel: 'Track my application',
      ctaHref: `${APP_URL}/apply/track`,
      footerNote: 'Keep this email so you have your reference.',
    }),
    'Application received',
    reference
  );

export const sendApplicationReminderOpen = (email: string) =>
  send(
    email,
    'TeenovateX applications are open',
    renderEmailShell({
      preheader: 'You asked us to tell you.',
      eyebrow: 'Applications open',
      heading: 'The window is open.',
      bodyHtml: '<p style="margin:0;">You asked us to let you know when applications open. They are open now.</p>',
      ctaLabel: 'Apply now',
      ctaHref: `${APP_URL}/apply`,
      footerNote: 'You are getting this because you asked for a reminder.',
    }),
    'Reminder',
    email
  );
