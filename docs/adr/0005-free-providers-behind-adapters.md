# ADR 0005: Free providers behind adapters

- Status: accepted
- Date: 2026-10-15

| Capability         | Local (free)                                                                                                     | Stubs for deployment                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Video              | Jitsi Meet (meet.jit.si or self-hosted)                                                                          | 100ms, Daily                          |
| Storage            | Local disk outside the web root, served via a signed, short-lived route with `Content-Disposition` and `nosniff` | S3-compatible                         |
| Email              | Nodemailer to Mailpit                                                                                            | Any SMTP or SES                       |
| Search             | MongoDB text indexes                                                                                             | Meilisearch (optional Docker service) |
| Bot protection     | No-op                                                                                                            | Turnstile-style adapter               |
| Breached passwords | HIBP k-anonymity range API (fails open)                                                                          | —                                     |

Each capability has a TypeScript interface in the API, and the adapter is chosen by env var at boot.
