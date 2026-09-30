import type { Request, Response } from 'express';
import { sendContactMessage } from '../lib/resend.js';

export const submitContact = async (req: Request, res: Response): Promise<void> => {
  const { name, email, topic, message, website } = req.body as {
    name: string;
    email: string;
    topic: string;
    message: string;
    website?: string;
  };

  // Honeypot tripped: pretend it worked so the bot learns nothing.
  if (website) {
    res.json({ message: 'Message sent' });
    return;
  }

  try {
    await sendContactMessage({ name, email, topic, message });
    res.json({ message: 'Message sent' });
  } catch {
    res.status(502).json({ error: "We couldn't send that just now. Please try again.", code: 'CONTACT_SEND_FAILED' });
  }
};
