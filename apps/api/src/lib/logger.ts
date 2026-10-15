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
