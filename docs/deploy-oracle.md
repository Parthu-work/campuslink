# Deploying on one Oracle server (the pilot)

This guide takes the owner from nothing to a live, hardened server: one Oracle Cloud **Always Free**
Ampere A1 instance (2 OCPU, 12 GB RAM, arm64) in India, behind Cloudflare's free plan. Every step
says who does it and how long it takes. The files it uses are in [`deploy/prod/`](../deploy/prod/README.md);
the reasons behind the choices are in [`docs/build/master-prompt-4.md`](build/master-prompt-4.md) §1.

**What it costs:** ₹0 a month for the server, Cloudflare, R2 backups (under 10 GB), Sentry and the
uptime monitor, plus the domain (about ₹700 to ₹1,000 a year). Chat answers, WhatsApp and SMS are
pay-per-use with caps (step 9); an idle day calls none of them.

**What you need first** (start the slow ones early: Meta and DLT take days to weeks):

| Input                                            | For                    | Without it                                               |
| ------------------------------------------------ | ---------------------- | -------------------------------------------------------- |
| Oracle Cloud account, upgraded to Pay As You Go  | the server             | nothing to deploy on                                     |
| A domain, DNS moved to Cloudflare                | every address          | nothing to deploy on                                     |
| A free SMTP account (Brevo or similar)           | sign-up and reset mail | the API refuses to start in production                   |
| Cloudflare R2 bucket and a token scoped to it    | off-site backups       | local backups only                                       |
| An age key pair, made on your own computer       | backup encryption      | no backups                                               |
| Sentry DSN (free plan), an uptime monitor (free) | errors, downtime       | errors only in the server log; no outside downtime alert |
| Anthropic API key with a monthly spend limit     | chat answers           | the assistant answers with passages only                 |
| Meta WhatsApp Business: verification, templates  | WhatsApp               | WhatsApp off; email and push only                        |
| DLT entity, header, templates; MSG91 prepaid     | SMS codes              | SMS off; phone sign-in by WhatsApp or email              |

## 1. Oracle Cloud (owner, 30 minutes)

1. Sign up at cloud.oracle.com with **Hyderabad (`ap-hyderabad-1`)** or **Mumbai (`ap-mumbai-1`)** as the
   home region. The home region cannot be changed later; it is where the data lives.
2. **Upgrade to Pay As You Go** (Billing › Upgrade). Always Free resources stay free; the upgrade stops
   Oracle from reclaiming an "idle" free instance and makes A1 capacity far easier to get.
3. **Budget alert at ₹1**: Billing › Budgets › Create budget, amount 1 (INR), alert at 100% of actual
   spend, to your email. Anything that would cost money then emails you the same day.
4. **Network**: Networking › Virtual cloud networks › Start VCN wizard › "VCN with Internet
   Connectivity". In the public subnet's **security list**, keep only:
   - TCP 22 from **your own address** (`<your.ip>/32`; add Oracle Cloud Shell's address only if you use it);
   - TCP 80 and 443 from each of Cloudflare's IPv4 ranges (<https://www.cloudflare.com/ips-v4>; one
     rule per range). Delete any 0.0.0.0/0 rule for 80, 443 or 22.
5. **Instance**: Compute › Instances › Create:
   - image **Canonical Ubuntu 24.04** (aarch64), shape **VM.Standard.A1.Flex**, **2 OCPU, 12 GB**;
   - the public subnet above, a public IPv4 address, your SSH public key;
   - boot volume 50 GB (the default).
     If Oracle says "out of capacity", try another availability domain or wait a few hours.
6. **Block volume**: Storage › Block volumes › Create, **150 GB**, same availability domain; then on the
   instance › Attached block volumes › Attach (paravirtualized). Boot (50) plus block (150) stays inside
   the 200 GB free allowance.

Oracle's Ubuntu images ship their own iptables rules (`/etc/iptables/rules.v4`, ending in a REJECT).
`provision.sh` inserts its rules ahead of them; you never need to open ports there by hand, and you
must not flush them.

## 2. Prepare the server (owner, 15 minutes)

```bash
ssh ubuntu@<server-ip>
```

```bash
lsblk
```

Find the block volume (150 GB, no partitions; usually `/dev/sdb`). Then, with your own address and
your own SSH public key:

```bash
curl -fsSLO https://raw.githubusercontent.com/Parthu-work/campuslink/main/deploy/prod/provision.sh
```

```bash
sudo SSH_ALLOW=<your.ip>/32 DEPLOY_KEY="$(cat ~/.ssh/authorized_keys | head -n 1)" BLOCK_DEVICE=/dev/sdb bash provision.sh
```

If the repository is private, clone it yourself first (`git clone` with a read-only deploy key into
`/srv/campuslink`) and run `/srv/campuslink/deploy/prod/provision.sh` instead of downloading it.

It creates the `deploy` user (SSH keys only; root and password login off), turns on unattended
security upgrades and fail2ban, adds a 4 GB swap file and time sync, installs Docker Engine with the
compose plugin (its data on the block volume), rclone and age, clones the repository to
`/srv/campuslink`, sets the firewall (80/443 from Cloudflare only, SSH from `SSH_ALLOW` only) and
enables the alert and Cloudflare-range timers. From now on, sign in as `deploy`:

```bash
ssh deploy@<server-ip>
```

## 3. Cloudflare (owner, 20 minutes)

1. Add the domain to Cloudflare (free plan) and change the registrar's name servers to Cloudflare's.
2. **DNS**, all **proxied** (orange cloud), all pointing at the server's public IPv4:
   `A  @  <ip>`, `A  admin  <ip>`, `A  *  <ip>` (the wildcard serves every college and `emp-` host).
3. **SSL/TLS › Overview**: **Full (strict)**. **Edge certificates**: Always Use HTTPS on, minimum TLS 1.2,
   HSTS left to the origin (it already sends two years with subdomains).
4. **SSL/TLS › Origin Server › Create certificate**: RSA, hostnames `<domain>` and `*.<domain>`, 15 years.
   On the server, save the two parts with mode 644 (nginx runs as uid 101):

   ```bash
   cd /srv/campuslink/deploy/prod && nano tls/fullchain.pem && nano tls/privkey.pem && chmod 644 tls/*.pem
   ```

5. **Security › WAF**: the free managed ruleset on. **Rate limiting rules** (free plan allows one):
   "If URI path starts with `/api/v1/auth/` then block for 10 seconds when more than 30 requests in 10
   seconds per IP". The application keeps its own, stricter limits behind it.
6. **Caching**: nothing to set. Cloudflare caches the hashed files under `/assets/` (the origin sends a
   one-year `immutable` header) and never caches HTML or `/api/*` (`no-cache` and `no-store`). Public
   pages (`/p/...`) follow the API's five-minute header. Do not add a "cache everything" rule.
7. **Network**: WebSockets on (the default).

## 4. Email DNS (owner, 10 minutes)

In your SMTP provider, add the sending domain; it shows three records. Add them in Cloudflare as
**DNS only** (grey cloud): SPF (`TXT @ "v=spf1 include:<provider> ~all"`), DKIM (the provider's
`TXT` or `CNAME`), and DMARC (`TXT _dmarc "v=DMARC1; p=quarantine; rua=mailto:<you>"`). Note the free
tier's daily limit (Brevo: 300 a day when this was written); invites to a cohort are sent in batches
under it.

## 5. Secrets and settings (owner, 15 minutes)

```bash
cd /srv/campuslink/deploy/prod && ./gen-secrets.sh --domain <your-domain>
```

This writes `.env`, `backup.env` and `secrets/` with every generated secret (nothing is printed;
it refuses to overwrite). **Copy all three into your password manager now**: without the field
encryption key and the rclone crypt passwords, backups cannot be read. Then edit `.env` and fill in
the settings marked `owner`: the SMTP account, `MAIL_FROM`, the Anthropic key (or leave chat off),
the AI prices for the cost report, the billing seller details, the Sentry DSN (`ERROR_REPORTER=sentry`).
Leave WhatsApp, SMS and payments `disabled` until their accounts are ready. Leave
`NETWORK_ENABLED=false` until you approve ADR 0014.

If the images are private on GitHub, let the server read them:

```bash
docker login ghcr.io -u <github-user>
```

(with a token that has only `read:packages`).

## 6. First start (owner, 10 minutes; ClamAV takes two of them)

```bash
cd /srv/campuslink/deploy/prod && docker compose pull && docker compose up -d --wait
```

```bash
./smoke.sh
```

The smoke test checks readiness, the security headers, the HTTP redirect, an unknown-host refusal,
that `/metrics` is hidden, a WebSocket handshake, an encrypted object round trip, ClamAV with the
EICAR file, Qdrant in one college only, the embedding model's vector size, the database user's
limits, that only the edge publishes ports, and that the logs carry no personal data.

## 7. Backups (owner, 10 minutes)

On your **own computer** (never on the server):

```bash
age-keygen -o campuslink-backup-key.txt
```

Keep that file offline (a password manager attachment and a USB key). Put its **public** line
(`age1…`) in `backup.env` as `BACKUP_AGE_RECIPIENT`, and fill in the R2 account id, bucket, token
and `ALERT_EMAIL`. Then:

```bash
sudo systemctl enable --now campuslink-backup.timer campuslink-drill.timer
```

```bash
./backup.sh
```

```bash
BACKUP_IDENTITY=<(ssh you@laptop cat campuslink-backup-key.txt) ./drill.sh
```

The first is the nightly backup run once by hand; the second restores it into a throwaway database
and reports document counts. Run the drill with the key once a quarter; the monthly timer checks the
newest backup downloads and matches its checksum.

## 8. The platform administrator and the first college (owner, 10 minutes)

```bash
docker compose exec api node dist/scripts/platform-bootstrap.js --email <your-email> --name "<your name>"
```

It prints a set-password link valid for 30 minutes, once. Open it, choose a password, sign in at
`https://admin.<domain>` and turn on two-factor (nothing else works until you do). It refuses to run
again once an administrator exists; `--reissue` prints a new link only if the first one expired unused.

In the platform console, create the demo college (Colleges › New college; the subdomain, branding and
its first administrator, who gets an invitation email). Apply the pilot preset:

```bash
docker compose exec api node dist/scripts/pilot-preset.js --slug <college> --dry-run
```

```bash
docker compose exec api node dist/scripts/pilot-preset.js --slug <college>
```

Then follow [`docs/build/launch-checklist.md`](build/launch-checklist.md).

## 9. Caps on everything that costs money (owner)

| Service     | The cap                                                                                                 | Where                                      |
| ----------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Anthropic   | a monthly spend limit (start at $10) and email alerts                                                   | console.anthropic.com › Limits             |
|             | each college's monthly token allowance (plan × seats; the preset lowers it), enforced before every call | `AiSettingsService.runtime()` (ADR 0009)   |
| WhatsApp    | each college's monthly allowance and each member's weekly cap, enforced before every message            | `ChannelService`                           |
|             | a payment method with a monthly limit in Meta Business                                                  | business.facebook.com › Billing            |
| SMS (MSG91) | a **prepaid** balance (top up ₹500 at a time) with a low-balance alert                                  | msg91.com                                  |
| Oracle      | the ₹1 budget alert (step 1)                                                                            | Oracle billing                             |
| R2          | an email from the backup when the bucket passes 8 GB (free tier 10 GB); per-college storage limits      | `backup.sh`, `EntitlementsService.limit()` |
| Razorpay    | not used until a college asks to pay online                                                             |                                            |

See month to date at any time (aggregates only):

```bash
docker compose exec api node dist/scripts/costs-report.js
```

## 10. Monitoring (owner, 10 minutes)

- **Uptime**: in UptimeRobot (free, 5-minute checks), add `https://<college>.<domain>/` and
  `https://admin.<domain>/api/v1/ready` with email alerts.
- **Errors**: Sentry free plan; the DSN in `.env` (`ERROR_REPORTER=sentry`). Reports are scrubbed of
  personal data before they leave the server.
- **Host alerts**: already on (step 2): disk over 80%, memory over 90% for 10 minutes, a container
  restarting more than three times an hour, the origin certificate within 30 days of expiry, the API
  not ready. They email `ALERT_EMAIL`. What each means: [`runbook.md`](runbook.md) › Single server.

## 11. Webhooks (owner, when each account is ready)

- **WhatsApp** (Meta app › WhatsApp › Configuration): callback URL `https://admin.<domain>/api/v1/webhooks/whatsapp`,
  verify token = `WHATSAPP_VERIFY_TOKEN` from `.env`; subscribe to `messages`.
- **Razorpay** (only when payments are on): `https://admin.<domain>/api/v1/webhooks/razorpay` with
  `RAZORPAY_WEBHOOK_SECRET`; events `payment_link.paid`.

Confirm the exact paths in [`docs/permissions.md`](permissions.md) before saving them.

## 12. Continuous deployment (owner, 15 minutes)

Every green CI run on `main` builds arm64 and amd64 images (`.github/workflows/release.yml`) and then
waits for your approval before deploying.

1. GitHub › Settings › Environments › New environment `production` › Required reviewers: you.
2. Make a key pair for the workflow (on your computer): `ssh-keygen -t ed25519 -f campuslink-release -N ""`.
3. On the server, add the **public** key to `/home/deploy/.ssh/authorized_keys`, pinned to one command:

   ```
   command="/srv/campuslink/deploy/prod/deploy-from-ci.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA… release
   ```

   It can then only deploy a commit that is on `main`; it cannot open a shell.

4. In the `production` environment's secrets: `DEPLOY_HOST` (the server's address),
   `DEPLOY_SSH_KEY` (the private key), `DEPLOY_KNOWN_HOSTS` (the output of `ssh-keyscan <server-ip>`).
5. SSH from GitHub's runners must reach port 22: either add GitHub's Actions address ranges to
   `SSH_ALLOW` in `/etc/campuslink/firewall.env` and the security list (they change; review monthly),
   or deploy by hand with `./deploy.sh <sha>` after approving the build.

The deploy pulls the commit's images, replaces `web`, `api` and `worker`, waits for readiness and
runs the smoke test; on any failure it puts the previous version back and emails you.

GitHub's Arm runners are free for public repositories. For a private repository, set the variable
`ARM_RUNNER` to `ubuntu-24.04` and add QEMU to the build (slower, within the free minutes), or make
the repository public (no secret is in it: gitleaks checks every push).

## Moving to a bigger server later

Everything is in containers and one env file. On the new server: steps 2 and 5 to 6 (copy `.env`,
`backup.env`, `secrets/` and `tls/` instead of generating them), restore the newest backup
([`runbook.md`](runbook.md) › Restore), point the DNS at it. For a managed database, change
`MONGODB_URI` and restore into it. The AWS layout for many colleges is in
[`deployment.md`](deployment.md) › Scale-up path.
