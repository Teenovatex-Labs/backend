import dotenv from 'dotenv';
import { z } from 'zod';

// Loading .env here (and importing this module first everywhere that reads
// config) guarantees values exist before anything reads them. Under systemd the
// same variables arrive through EnvironmentFile and dotenv leaves them alone.
// Tests never read .env: it holds real keys (email, uploads) that a test must not touch.
if (process.env.NODE_ENV !== 'test') dotenv.config();

// Outside production a missing secret gets a clearly-named development value so
// local work and tests run without setup. In production nothing is ever defaulted:
// the process refuses to start instead of signing tokens with a guessable key.
const buildSchema = (isProduction: boolean) => {
  const devDefault = (value: string) => (isProduction ? undefined : value);

  return z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      PORT: z.coerce.number().int().positive().default(3000),
      DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
      JWT_SECRET: z
        .string()
        .min(32, 'JWT_SECRET must be at least 32 characters')
        .default(devDefault('dev-only-access-secret-do-not-use-in-production') as string),
      JWT_REFRESH_SECRET: z
        .string()
        .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters')
        .default(devDefault('dev-only-refresh-secret-do-not-use-in-production') as string),
      // Comma-separated list of browser origins allowed by CORS.
      FRONTEND_URL: z
        .string()
        .min(1, 'FRONTEND_URL is required')
        .default(devDefault('http://localhost:3000,http://app.localhost:3000') as string),
      SITE_URL: z.string().default('https://www.teenovatex.org'),
      APP_URL: z.string().default('https://app.teenovatex.org'),
      GOOGLE_CLIENT_ID: z.string().optional(),
      RESEND_API_KEY: z.string().optional(),
      RESEND_FROM: z.string().default('TeenovateX Labs <onboarding@resend.dev>'),
      CONTACT_TO: z.string().optional(),
      CLOUDINARY_CLOUD_NAME: z.string().optional(),
      CLOUDINARY_API_KEY: z.string().optional(),
      CLOUDINARY_API_SECRET: z.string().optional(),
      // Alfred's brain: free-tier providers tried in order, each with any number of keys
      // (comma-separated) so a spare key takes over when one is rate-limited.
      GEMINI_API_KEYS: z.string().optional(),
      // Web push. Without both keys, push is simply off.
      VAPID_PUBLIC_KEY: z.string().optional(),
      VAPID_PRIVATE_KEY: z.string().optional(),
      VAPID_SUBJECT: z.string().default('mailto:hello@teenovatex.org'),
      GEMINI_MODEL: z.string().default('gemini-flash-lite-latest'),
      GROQ_API_KEYS: z.string().optional(),
      GROQ_MODEL: z.string().default('openai/gpt-oss-20b'),
      PET_PROVIDER_ORDER: z.string().default('gemini,groq'),
      PET_DAILY_LIMIT: z.coerce.number().int().positive().default(40),
      // Global kill switch: set to "false" to turn the AI brain off for everyone at once.
      PET_AI_ENABLED: z.string().default('true'),
      // Comma-separated emails that become admin automatically once they have verified the address.
      ADMIN_EMAILS: z.string().optional(),
    })
    .refine((c) => c.JWT_SECRET !== c.JWT_REFRESH_SECRET, {
      message: 'JWT_SECRET and JWT_REFRESH_SECRET must be different',
      path: ['JWT_REFRESH_SECRET'],
    });
};

const splitKeys = (raw?: string) => (raw ?? '').split(',').map((k) => k.trim()).filter(Boolean);

export const parseConfig = (env: NodeJS.ProcessEnv) => {
  const result = buildSchema(env.NODE_ENV === 'production').safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.') || 'config'}: ${i.message}`).join('\n');
    throw new Error(`Invalid server configuration:\n${problems}`);
  }
  const c = result.data;
  return {
    env: c.NODE_ENV,
    isProduction: c.NODE_ENV === 'production',
    port: c.PORT,
    databaseUrl: c.DATABASE_URL,
    jwt: { access: c.JWT_SECRET, refresh: c.JWT_REFRESH_SECRET },
    allowedOrigins: c.FRONTEND_URL.split(',').map((o) => o.trim()).filter(Boolean),
    siteUrl: c.SITE_URL,
    appUrl: c.APP_URL,
    googleClientId: c.GOOGLE_CLIENT_ID,
    resend: { apiKey: c.RESEND_API_KEY, from: c.RESEND_FROM },
    contactTo: c.CONTACT_TO,
    adminEmails: splitKeys(c.ADMIN_EMAILS).map((e) => e.toLowerCase()),
    pet: {
      enabled: c.PET_AI_ENABLED !== 'false',
      dailyLimit: c.PET_DAILY_LIMIT,
      order: c.PET_PROVIDER_ORDER.split(',').map((x) => x.trim()).filter((x): x is 'gemini' | 'groq' => x === 'gemini' || x === 'groq'),
      gemini: { keys: splitKeys(c.GEMINI_API_KEYS), model: c.GEMINI_MODEL },
      groq: { keys: splitKeys(c.GROQ_API_KEYS), model: c.GROQ_MODEL },
    },
    push: { publicKey: c.VAPID_PUBLIC_KEY, privateKey: c.VAPID_PRIVATE_KEY, subject: c.VAPID_SUBJECT },
    cloudinary: {
      cloudName: c.CLOUDINARY_CLOUD_NAME,
      apiKey: c.CLOUDINARY_API_KEY,
      apiSecret: c.CLOUDINARY_API_SECRET,
    },
  };
};

export const config = parseConfig(process.env);
