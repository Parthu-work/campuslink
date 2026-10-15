import cors from 'cors';

/** Convert allowlist entries (supporting a leading `*.` subdomain wildcard) into matchers. */
export function buildOriginMatcher(allowed: string[]) {
  const matchers = allowed.map((entry) => {
    const url = new URL(entry.replace('://*.', '://wildcard.'));
    if (!entry.includes('://*.')) return (o: URL) => o.origin === url.origin;
    const suffix = '.' + url.host.slice('wildcard.'.length);
    return (o: URL) =>
      o.protocol === url.protocol &&
      o.host.endsWith(suffix) &&
      /^[a-z0-9-]+$/.test(o.host.slice(0, -suffix.length));
  });
  return (origin: string | undefined): boolean => {
    if (!origin) return false;
    try {
      const o = new URL(origin);
      return matchers.some((m) => m(o));
    } catch {
      return false;
    }
  };
}

export function corsMiddleware(allowed: string[]) {
  const isAllowed = buildOriginMatcher(allowed);
  return cors({
    origin: (origin, cb) => cb(null, isAllowed(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-CSRF-Token', 'Idempotency-Key'],
    maxAge: 600,
  });
}
