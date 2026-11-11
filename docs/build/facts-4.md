# Prompt 4: verified facts

A copy of [`master-prompt-4.md`](master-prompt-4.md) §2, kept current. Corrections found while
working are marked **(corrected)** or **(new)** with the date.

## Baseline

- Branch `claude/clever-hypatia-cpgn8m` (this session), from `main` at `094acfc`, with Prompt 3's
  `claude/vigilant-lamport-rdkzex` merged at its newest green commit `dcaeedc` (CI run 42388325001,
  green, 7 Nov 2026). Prompt 3 had pushed nothing newer when this prompt started (10 Nov 2026).

## Deploy files (as found)

- `deploy/`: `api.Dockerfile`, `worker.Dockerfile` (ffmpeg, poppler-utils, Tesseract eng and tel; **no
  Hindi**), `web.Dockerfile`, `nginx/{campuslink.conf, security-headers.conf, static.conf, web-container.conf}`,
  `staging/{compose.yml, edge.conf, up.sh, smoke.sh, down.sh}`. Base images `mirror.gcr.io/library/node:22-slim`
  and `nginx:1.28-alpine`.
- The staging compose is a rehearsal: no MongoDB authentication, no Redis password, no restart
  policies, memory limits, log rotation or Qdrant.
- `deploy/nginx/campuslink.conf` used the placeholder `.campuslink.example`.
- **(new, 11 Nov)** `campuslink.conf` and `staging/edge.conf` had the study-upload location regex
  `{24}` unquoted, which nginx rejects ("missing closing parenthesis"): neither file could have
  started as written. Quoted in both.
- **(new, 11 Nov)** `clamav/clamav:1.5.4` publishes **no arm64** image; `clamav/clamav-debian:1.5.4`
  does (amd64, arm64, ppc64le). Production uses the Debian build. `qdrant/qdrant:v1.19.2`,
  `chrislusf/seaweedfs:4.48`, `ollama/ollama:0.12.6` and the library images are multi-arch.

## Application

- **(new, 11 Nov)** `fflate` was a devDependency of `apps/api` although `modules/study/extract/office.ts`
  imports it at run time: the production API image (`pnpm deploy --prod`) failed to start with
  `ERR_MODULE_NOT_FOUND`. Moved to dependencies. No other runtime import is missing.
- Production refusals (`config/env.ts`): placeholder secrets, `RATE_LIMIT_SCALE > 2`, `MAIL_DRIVER=disabled`,
  WhatsApp cloud without `WHATSAPP_ACTION_SECRET`, `PAYMENT_PROVIDER=stub`, console SMS/WhatsApp,
  `S3_SSE=none`, `MALWARE_SCANNER=none`. **Added in prompt 4:** `APP_ROOT_DOMAIN=localhost`, a
  `MONGODB_URI` without credentials, `VECTOR_STORE=memory` with `PROCESS_ROLE=api`; `REHEARSAL=true`
  (staging only) lifts the first two.
- **(new)** Empty env values (`KEY=`) were parsed as values (an empty URL failed, an empty number
  became 0). They now count as unset.
- No production bootstrap existed: `scripts/seed.ts` refuses production. **Added:** `platform:bootstrap`.
- The worker ran about 15 `setInterval` timers in `server.ts`. **Replaced** by `lib/scheduler.ts`.
- **(new)** `test/reach.test.ts` › the roster sync used fixed dates in early November; its pending
  diff expires after seven days, so it started failing on 9 Nov 2026 on `main`. Now relative to this week.
- **(corrected)** ADR 0014's own status reads "proposed", while `progress.md` and `report-2.md` said
  "approved". Prompt 4 asked the owner; until an answer is recorded, `NETWORK_ENABLED` is off in production.

## Dependencies (11 Nov 2026)

- **(new)** `pnpm audit --prod` showed 2 high and 4 moderate advisories in `mongoose` 9.11.2 (fixed in
  9.11.4), one low in `fast-xml-parser` 5.11.2, and the known moderate `glob`/`minimatch` through
  `write-excel-file` 2 → `archiver`. After upgrading `mongoose` ^9.12.1, `fast-xml-parser` ^5.12.0
  and `write-excel-file` ^4.1.1 (no `archiver`): no known vulnerabilities.

## This session's environment (not the owner's)

- Outbound access goes through a policy proxy: `registry.ollama.ai` and `huggingface.co` are blocked,
  so the embedding model could not be downloaded here; Docker Hub rate-limits, `mirror.gcr.io` works.
- The machine is x86_64 with a 20,000 open-file limit (MongoDB's compose limit is 64,000; the
  rehearsal used an override). arm64 is exercised by the release workflow on GitHub's Arm runners.

## External facts (from the prompt, checked 10 Nov 2026; re-check before relying on them)

- Oracle Always Free A1: 2 OCPU and 12 GB (halved from 4/24 in August 2026), 200 GB block storage,
  10 TB outbound a month; Pay As You Go keeps Always Free resources free.
- Cloudflare R2 free tier: 10 GB-month, 1M Class A and 10M Class B operations, no egress fees.
- Cloudflare free plan: request bodies up to 100 MB (the pilot caps study media at 50 MB).
