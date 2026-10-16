# Deployment files

- `nginx/campuslink.conf`: the reverse proxy (TLS, wildcard college subdomains, the SPA, `/api` and Socket.io).
- `nginx/security-headers.conf`: CSP, HSTS and the other browser security headers.
  - Install it as `/etc/nginx/snippets/campuslink-security-headers.conf`.
  - `vite preview` serves the same headers, so the end-to-end suite runs under the production policy.
  - `apps/web/src/lib/security-headers.test.ts` checks it.

See `docs/deployment.md` for the full production setup.
