# Deployment files

- `api.Dockerfile`, `worker.Dockerfile`, `web.Dockerfile`: production images (build from the repository root). The worker runs the background jobs and carries ffmpeg and Tesseract for study processing; the API image has neither (`PROCESS_ROLE`, `docs/deployment.md`).
- `nginx/security-headers.conf`: CSP, HSTS and the other browser security headers.
  - Install it as `/etc/nginx/snippets/campuslink-security-headers.conf`.
  - `vite preview` serves the same headers, so the end-to-end suite runs under the production policy.
  - `apps/web/src/lib/security-headers.test.ts` checks it.
- `nginx/static.conf`: the SPA's static files and caching (`/etc/nginx/snippets/campuslink-static.conf`).
- `nginx/web-container.conf`: the web container behind an AWS ALB (port 8080; the ALB routes `/api/*` to the API).
- `nginx/campuslink.conf`: a single host where nginx terminates TLS and proxies `/api` and Socket.io.

See `docs/deployment.md` for the full production setup and `docs/runbook.md` for operations.
