# Architecture

Phase 0 skeleton. This document grows each phase.

```mermaid
flowchart LR
  subgraph Client
    PWA[React PWA<br/>service worker, i18n]
  end
  subgraph API[apps/api: modular monolith]
    MW[request-id → helmet → cors → rate-limit → tenant → auth] --> MOD[modules: auth · tenants · feed · mentorship · jobs · roadmaps …]
    MOD --> REPO[repositories<br/>tenant plugin]
  end
  W[BullMQ workers<br/>imports · ingestion · reminders]
  PWA -- HTTPS /api/v1 --> MW
  PWA -- Socket.io --> MOD
  REPO --> M[(MongoDB)]
  MOD --> R[(Redis)]
  W --> M
  W --> R
  MOD --> SMTP[Mailpit / SMTP]
```

## Request pipeline

`route → validate (Zod) → authenticate → authorize → controller → service → repository`

## Phases

0 Foundation · 1 Secure core · 2 People · 3 Mentorship · 4 Feed and content · 5 Jobs and referrals · 6 Roadmaps and Career Galaxy · 7 Gamification, events, analytics · 8 Hardening and launch.

See `docs/adr/` for decisions.
