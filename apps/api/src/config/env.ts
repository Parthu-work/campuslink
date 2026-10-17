import { z } from 'zod';
import { APP_NAME } from '@campuslink/shared';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const secret = z.string().min(32, 'must be at least 32 characters');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_ROOT_DOMAIN: z.string().min(1).default('localhost'),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  CORS_ALLOWED_ORIGINS: csv,
  MONGODB_URI: z.string().startsWith('mongodb').default('mongodb://127.0.0.1:27017/campuslink'),
  REDIS_URL: z.string().startsWith('redis').default('redis://127.0.0.1:6379'),
  JWT_ACCESS_SECRET: secret.default('test-only-access-secret-xxxxxxxxxxxxxxxxxxxx'),
  JWT_TICKET_SECRET: secret.default('test-only-ticket-secret-xxxxxxxxxxxxxxxxxxxx'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(1_209_600),
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'must be 32 bytes, base64-encoded',
    })
    .default('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='),
  HIBP_ENABLED: bool,
  /** Defaults to true in production. Browsers treat *.localhost as secure, but we keep dev cookies plain for other hosts. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  SMTP_HOST: z.string().default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default(`${APP_NAME} <no-reply@campuslink.localhost>`),
  /** `disabled` drops mail silently (end-to-end runs without Mailpit). Mail bodies are never logged: they contain tokens. */
  MAIL_DRIVER: z.enum(['smtp', 'disabled']).default('smtp'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('./uploads'),
  /** S3 storage (STORAGE_DRIVER=s3). Credentials default to the AWS chain (the ECS task role). */
  S3_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid bucket name')
    .optional(),
  S3_REGION: z.string().min(1).default('ap-south-1'),
  /** S3-compatible endpoint (path-style); leave unset for AWS. */
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  S3_PREFIX: z
    .string()
    .regex(/^([a-z0-9-]+\/)*$/, 'lowercase path segments ending in /')
    .default('files/'),
  S3_SSE: z.enum(['none', 'AES256', 'aws:kms']).default('aws:kms'),
  S3_KMS_KEY_ID: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  SMS_PROVIDER: z.enum(['disabled']).default('disabled'),
  /** Malware scanning of every stored file (ClamAV clamd). Required in production; fails closed. */
  MALWARE_SCANNER: z.enum(['none', 'clamav']).default('none'),
  /** clamd address: `host:port` or an absolute Unix socket path. */
  CLAMAV_ADDRESS: z.string().min(1).default('127.0.0.1:3310'),
  /** bullmq (Redis-backed, default) or inline (in-process; tests only). */
  JOBS_DRIVER: z.enum(['bullmq', 'inline']).default('bullmq'),
  /** Multiplies every rate limit. Raised only for automated test runs; capped at 2 in production. */
  RATE_LIMIT_SCALE: z.coerce.number().positive().max(1000).default(1),
  /** Video adapter: Jitsi (default, free) or the 100ms / Daily stubs. */
  VIDEO_PROVIDER: z.enum(['jitsi', '100ms', 'daily']).default('jitsi'),
  JITSI_BASE_URL: z.url({ protocol: /^https$/ }).default('https://meet.jit.si'),
  /** Self-hosted Jitsi with token auth: links then carry a JWT that expires with the join window. */
  JITSI_APP_ID: z.string().min(1).optional(),
  JITSI_APP_SECRET: z.string().min(32).optional(),
  /** Bot protection on sign-up and mentorship requests (Turnstile-style). Disabled locally. */
  BOT_PROTECTION: z.enum(['none', 'turnstile']).default('none'),
  TURNSTILE_SECRET: z.string().min(1).optional(),
  /** Public Turnstile site key, sent to the web app with the college branding. */
  TURNSTILE_SITE_KEY: z
    .string()
    .regex(/^[0-9A-Za-z_-]{10,100}$/)
    .optional(),
  /** Web push (VAPID). Without keys, push is reported as unavailable. Generate: pnpm --filter @campuslink/api vapid */
  VAPID_PUBLIC_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{80,100}$/)
    .optional(),
  VAPID_PRIVATE_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{40,50}$/)
    .optional(),
  /** Adzuna job search API (free tier, your own keys; off when unset). Terms require "Jobs by Adzuna". */
  ADZUNA_APP_ID: z.string().min(1).max(100).optional(),
  ADZUNA_APP_KEY: z.string().min(1).max(200).optional(),
  /** Content ingestion scheduler (off in tests and end-to-end runs). */
  INGESTION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:|https:\/\/)/)
    .default('mailto:no-reply@campuslink.localhost'),
});

export type Env = z.infer<typeof envSchema>;

const INSECURE_DEFAULT_MARKERS = ['change-me', 'test-only', 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='];

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Print only variable names and reasons; never echo values (they may be secrets).
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (!!env.JITSI_APP_ID !== !!env.JITSI_APP_SECRET)
    throw new Error('Set both JITSI_APP_ID and JITSI_APP_SECRET, or neither');
  if (env.BOT_PROTECTION === 'turnstile' && (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY))
    throw new Error('BOT_PROTECTION=turnstile needs TURNSTILE_SECRET and TURNSTILE_SITE_KEY');
  if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) throw new Error('STORAGE_DRIVER=s3 needs S3_BUCKET');
  if (!!env.S3_ACCESS_KEY_ID !== !!env.S3_SECRET_ACCESS_KEY)
    throw new Error('Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither');
  if (!!env.VAPID_PUBLIC_KEY !== !!env.VAPID_PRIVATE_KEY)
    throw new Error('Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither');
  if (env.NODE_ENV === 'production') {
    const weak = (['JWT_ACCESS_SECRET', 'JWT_TICKET_SECRET', 'FIELD_ENCRYPTION_KEY'] as const).filter((k) =>
      INSECURE_DEFAULT_MARKERS.some((m) => env[k].includes(m)),
    );
    if (weak.length)
      throw new Error(`Refusing to start in production with placeholder secrets: ${weak.join(', ')}`);
    if (env.RATE_LIMIT_SCALE > 2) throw new Error('RATE_LIMIT_SCALE above 2 is not allowed in production');
    if (env.MAIL_DRIVER === 'disabled') throw new Error('MAIL_DRIVER=disabled is not allowed in production');
    if (env.STORAGE_DRIVER === 's3' && env.S3_SSE === 'none')
      throw new Error('S3_SSE=none is not allowed in production (files must be encrypted at rest)');
    if (env.MALWARE_SCANNER === 'none')
      throw new Error(
        'MALWARE_SCANNER=clamav is required in production (uploads are scanned before storage)',
      );
  }
  return env;
}
