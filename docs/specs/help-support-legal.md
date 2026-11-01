# Help, support, legal pages and observability (build B14)

## Goal

Members get help without email chains, the college's legal pages are real and versioned, and errors reach the team before a college reports them.

## Help centre

- `/help` (every signed-in member): seven short guides (`HELP_ARTICLES`), one markdown file per language in `apps/web/src/features/help/articles/<locale>/<id>.md`, each loaded only when opened and rendered with the markdown subset (`DocText`: `## ` sections, then `RichText`). Titles and summaries are i18n strings.
- **Report a problem** (`support:create`, every member, verified or not): category, a short subject, what happened and an optional screenshot. The screenshot is uploaded first (`POST /support/screenshots`, re-encoded WebP, purpose `support_screenshot`) and claimed once by the report; it is kept 180 days.
- Categories route the report (`deskFor`): `bug` goes to the platform owner, everything else to the college's admins (`support:manage`).
- A report is a short thread (at most 50 replies): the member and the desk reply; a desk reply marks it _answered_ and tells the member (`support_reply`); a member's reply reopens it. Either side can close or reopen it. A member has at most 5 open reports.
- **Admin › Support** (`support:manage`, group _college_): the college's queue, with an overview count of open reports. **Platform › Support** (`platform:support`): bug reports from every college, read college by college; reading or answering one is recorded in that college's audit log.
- Notifications carry the report's id and category only, never its text.

## Legal pages and re-consent

- The privacy policy and terms are platform templates (`apps/api/src/modules/tenants/legal-templates.ts`), versioned with `PRIVACY_NOTICE_VERSION`, filled with the college's legal name, address, grievance officer and deletion grace period. English only; a translation is a new, reviewed version. **Needs legal review.**
- `GET /legal/:doc` (public) renders them; `/legal/privacy` and `/legal/terms` are public pages in the app, linked from Help, Settings › Privacy and the notice gate.
- **Admin › Branding › Legal details** (`tenant:branding`): publishing bumps `tenant.legal.version` and is audited.
- The notice version a member accepts is `PRIVACY_NOTICE_VERSION`, plus `+c<version>` once the college has published. `GET /me` returns `notice: { version, accepted }`; the member's latest `account` or `privacy_notice` consent record decides it (no record at all counts as accepted: such accounts predate consent records). When it is not accepted, the app shows the notice gate before anything else; `POST /me/notice` records the acceptance (append-only consent record, audited). Sign-ups record the current version.
- **Settings › Privacy** shows the grievance officer and links to both documents.

## Error reporting

- `ErrorReporter` (`apps/api/src/lib/error-reporter.ts`): `disabled`, `console` or `sentry` (`ERROR_REPORTER`, `ERROR_REPORTER_DSN`). The Sentry adapter speaks the envelope protocol directly (Sentry, self-hosted Sentry, GlitchTip), through `safeFetch` restricted to the DSN host; it never throws.
- The API reports unhandled errors (status ≥ 500) with the error type, a scrubbed message, the request id, the route pattern and the college's slug. Failed jobs report their name and scrubbed message.
- Browsers report broken screens and failed chunk loads from the route error element (`lib/report-error.ts`, loaded only on error) to `POST /client-errors` on the college's own API, which hands them to the same reporter. So no DSN reaches the browser and the CSP needs no new source (a deliberate change from the prompt, which suggested adding the DSN host to the CSP). Browser reports carry a one-way hash of the member's id, never the id.
- `scrub()` removes emails, phone numbers, long digit runs, object ids and token-like strings, and caps the length; query strings are dropped. A test scans the payload.

## Metrics

`GET /metrics` on the platform host, with `Authorization: Bearer <METRICS_TOKEN>` (404 when the token is unset): Prometheus text format, per process. Counters: requests by route pattern, method and status; jobs by name and outcome; one-time codes by channel; WhatsApp delivery failures; AI tokens by kind and direction; browser error reports; server errors. Labels never hold a member, a college or free text.

## Read-only colleges

Accepting a notice, browser error reports, and reporting a problem (create, reply, close) work while a college is read-only (`readOnlyOk`, pinned in the billing test); the screenshot upload does not.

## Tests

- `test/support.test.ts`: routing, plain text, the desk's queue and overview count, replies and notifications, the open-report cap, screenshots (claim once, access), the platform desk with audit, isolation between colleges.
- `test/legal.test.ts`: public pages, incomplete details, publishing (permissions, audit, version), re-consent and its version check, sign-ups after publishing, another college's own pages.
- `test/observability.test.ts`: metrics token and host, route patterns only, no personal data in labels, client error relay, scrubbing, the Sentry envelope, a reporter that cannot send.
- `test/privacy.test.ts`: reports are exported and erased with the member.
- `e2e/help.spec.ts`: a guide, a report answered by the college, the public policy and the grievance officer.
