import { z } from 'zod';

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
  MAIL_FROM: z.string().default('CampusLink <no-reply@campuslink.localhost>'),
  /** `disabled` drops mail silently (end-to-end runs without Mailpit). Mail bodies are never logged: they contain tokens. */
  MAIL_DRIVER: z.enum(['smtp', 'disabled']).default('smtp'),
  /** Multiplies every rate limit. Raised only for automated test runs; capped at 2 in production. */
  RATE_LIMIT_SCALE: z.coerce.number().positive().max(1000).default(1),
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
  if (env.NODE_ENV === 'production') {
    const weak = (['JWT_ACCESS_SECRET', 'JWT_TICKET_SECRET', 'FIELD_ENCRYPTION_KEY'] as const).filter((k) =>
      INSECURE_DEFAULT_MARKERS.some((m) => env[k].includes(m)),
    );
    if (weak.length)
      throw new Error(`Refusing to start in production with placeholder secrets: ${weak.join(', ')}`);
    if (env.RATE_LIMIT_SCALE > 2) throw new Error('RATE_LIMIT_SCALE above 2 is not allowed in production');
    if (env.MAIL_DRIVER === 'disabled') throw new Error('MAIL_DRIVER=disabled is not allowed in production');
  }
  return env;
}
