import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSecurityHeaders, previewSecurityHeaders, SECURITY_HEADERS_FILE } from '../../security-headers';

const TURNSTILE = 'https://challenges.cloudflare.com';
const headers = parseSecurityHeaders(readFileSync(SECURITY_HEADERS_FILE, 'utf8'));
const csp = new Map(
  (headers['Content-Security-Policy'] ?? '')
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .filter((d) => d[0])
    .map(([name = '', ...values]) => [name, values]),
);

describe('production security headers (deploy/nginx/security-headers.conf)', () => {
  it('has a strict CSP: no inline script, no plugins, no framing; one pinned third-party origin', () => {
    expect(csp.get('default-src')).toEqual(["'self'"]);
    // The Turnstile human check is the only third-party origin, for its script and iframe only.
    expect(csp.get('script-src')).toEqual(["'self'", TURNSTILE]);
    expect(csp.get('frame-src')).toEqual([TURNSTILE]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('connect-src')).toEqual(["'self'"]);
    expect(csp.has('upgrade-insecure-requests')).toBe(true);
    // Nothing anywhere allows eval, inline script or a wildcard source.
    for (const [name, values] of csp) {
      expect(values, name).not.toContain("'unsafe-eval'");
      expect(values, name).not.toContain('*');
      expect(values, name).not.toContain('http:');
      expect(values, name).not.toContain('https:');
      if (name !== 'style-src') expect(values, name).not.toContain("'unsafe-inline'");
      const remote = values.filter((v) => /^https?:/.test(v));
      expect(
        remote.every((v) => v === TURNSTILE),
        name,
      ).toBe(true);
      if (remote.length) expect(['script-src', 'frame-src'], name).toContain(name);
    }
  });

  it('sets HSTS for two years with subdomains, and the other hardening headers', () => {
    const hsts = headers['Strict-Transport-Security'] ?? '';
    expect(Number(/max-age=(\d+)/.exec(hsts)?.[1])).toBeGreaterThanOrEqual(31_536_000);
    expect(hsts).toContain('includeSubDomains');
    expect(headers).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'browsing-topics']) {
      expect(headers['Permissions-Policy']).toContain(`${feature}=()`);
    }
  });

  it('the index.html shell has no inline script, so script-src self holds', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    for (const tag of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
      expect(tag[0]).toMatch(/\ssrc="/);
      expect(tag[1]?.trim()).toBe('');
    }
    expect(html).not.toMatch(/\son[a-z]+="/i);
  });

  it('every nginx location that serves the app includes the headers', () => {
    // nginx drops server-level add_header lines in a location that sets its own, so each location
    // must include the snippet itself.
    const conf = readFileSync(new URL('../../../../deploy/nginx/static.conf', import.meta.url), 'utf8');
    const blocks = [...conf.matchAll(/location\s+[^{]+\{([^}]*)\}/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const [, body] of blocks) expect(body).toContain('campuslink-security-headers.conf');
  });

  it('vite preview serves the same policy minus the HTTPS-only parts', () => {
    const preview = previewSecurityHeaders();
    expect(preview['Strict-Transport-Security']).toBeUndefined();
    expect(preview['Content-Security-Policy']).not.toContain('upgrade-insecure-requests');
    expect(preview['Content-Security-Policy']).toContain(
      "script-src 'self' https://challenges.cloudflare.com",
    );
    expect(preview['X-Frame-Options']).toBe('DENY');
  });
});
