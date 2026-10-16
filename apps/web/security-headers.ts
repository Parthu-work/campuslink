import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The production header snippet (deploy/nginx/security-headers.conf), the single source of truth. */
export const SECURITY_HEADERS_FILE = fileURLToPath(
  new URL('../../deploy/nginx/security-headers.conf', import.meta.url),
);

/** Parses `add_header Name "value" always;` lines into a header map. */
export function parseSecurityHeaders(conf: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of conf.matchAll(/^add_header\s+([A-Za-z-]+)\s+"([^"]*)"\s+always;$/gm)) {
    const [, name, value] = m;
    if (name && value !== undefined) out[name] = value;
  }
  return out;
}

/**
 * Headers for `vite preview` (the end-to-end server). It is plain HTTP on localhost, so the
 * HTTPS-only parts are left out: browsers ignore HSTS over HTTP, and upgrade-insecure-requests
 * would rewrite every same-origin request to https.
 */
export function previewSecurityHeaders(): Record<string, string> {
  const h = parseSecurityHeaders(readFileSync(SECURITY_HEADERS_FILE, 'utf8'));
  delete h['Strict-Transport-Security'];
  const csp = h['Content-Security-Policy'];
  if (csp) {
    h['Content-Security-Policy'] = csp
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d && d !== 'upgrade-insecure-requests')
      .join('; ');
  }
  return h;
}
