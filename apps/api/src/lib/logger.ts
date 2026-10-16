import { pino } from 'pino';

/**
 * Structured logger. Redaction is a safety net, not a licence: never log request bodies,
 * tokens, or personal data deliberately.
 */
export function createLogger(level: string) {
  return pino({
    level,
    base: { service: 'campuslink-api' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-csrf-token"]',
        'req.headers["x-bot-token"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.refreshToken',
        '*.otp',
        '*.phone',
        '*.email',
      ],
      censor: '[redacted]',
    },
  });
}
export type Logger = ReturnType<typeof createLogger>;

type LoggedRequest = { id?: unknown; method?: string; url?: string };
type LoggedResponse = { statusCode?: number };

/**
 * Access-log serializers for pino-http: an allowlist, so new headers never leak by default. No
 * headers (tokens, cookies, CSRF and bot tokens), no query string (search terms, ids), no client IP
 * or user agent (personal data; the audit log keeps a truncated IP prefix where it is needed).
 */
export const httpLogSerializers = {
  req: (req: LoggedRequest) => ({
    id: req.id,
    method: req.method,
    path: typeof req.url === 'string' ? req.url.split('?')[0] : undefined,
  }),
  res: (res: LoggedResponse) => ({ statusCode: res.statusCode }),
};
