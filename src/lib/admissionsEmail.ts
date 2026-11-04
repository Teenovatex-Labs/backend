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

export const sendAcceptance = (email: string, inviteToken: string, days: number) => {
  const link = `${APP_URL}/signup?invite=${inviteToken}`;
  return send(
    email,
    'You are in: welcome to TeenovateX',
    renderEmailShell({
      preheader: 'Your application was accepted.',
      eyebrow: 'Decision',
      heading: 'You&rsquo;re in.',
      bodyHtml: `<p style="margin:0 0 12px;">Congratulations, your application was accepted. Use the button to create your account with this email address. The invitation works once and expires in ${days} days.</p>`,
      ctaLabel: 'Create my account',
      ctaHref: link,
      footerNote: 'This invitation only works for the email address it was sent to.',
    }),
    'Acceptance',
    link
  );
};

export const sendDecline = (email: string, feedback: string | null) =>
  send(
    email,
    'Your TeenovateX application',
    renderEmailShell({
      preheader: 'An update on your application.',
      eyebrow: 'Decision',
      heading: 'Not this time.',
      bodyHtml: `<p style="margin:0 0 12px;">Thank you for applying. We were not able to offer you a place in this round, and that is not a judgement of you. You are welcome to apply again in a future window.</p>${feedback ? `<p style="margin:0;"><strong>A note from the team:</strong> ${feedback.replace(/</g, '&lt;')}</p>` : ''}`,
      ctaLabel: 'See when we open again',
      ctaHref: `${APP_URL}/apply`,
      footerNote: 'You can reapply in any later window.',
    }),
    'Decline',
    email
  );

export const sendWaitlisted = (email: string) =>
  send(
    email,
    'Your TeenovateX application: waitlisted',
    renderEmailShell({
      preheader: 'You are on the waitlist.',
      eyebrow: 'Decision',
      heading: 'On the waitlist.',
      bodyHtml: '<p style="margin:0;">We liked your application but this round is full. You stay on the waitlist until the next review, and we will contact you then with an update or clear next steps.</p>',
      ctaLabel: 'Track my application',
      ctaHref: `${APP_URL}/apply/track`,
      footerNote: 'No action is needed from you.',
    }),
    'Waitlist',
    email
  );

export const sendClarificationRequest = (email: string, days: number) =>
  send(
    email,
    'A question about your TeenovateX application',
    renderEmailShell({
      preheader: 'Our team has a question for you.',
      eyebrow: 'Your application',
      heading: 'One quick question.',
      bodyHtml: `<p style="margin:0;">A reviewer asked for a little more detail. Open your application and reply within ${days} days.</p>`,
      ctaLabel: 'Open my application',
      ctaHref: `${APP_URL}/apply/track`,
      footerNote: 'Use the link from your earlier email, or ask for a new one on the apply page.',
    }),
    'Clarification',
    email
  );
