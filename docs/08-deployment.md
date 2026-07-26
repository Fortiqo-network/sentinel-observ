# 08 — Deployment runbook (Vercel + monitor.fortiqo.xyz)

Target: **https://monitor.fortiqo.xyz** — its own Vercel project with Cloudflare DNS, the same shape as `sentinel.fortiqo.xyz` and `docs.fortiqo.xyz`.

Do the parts in order. Each one ends in something you can verify before moving on.

---

## Part A — Create the Slack bot

Follow [03-slack-bot-setup.md](03-slack-bot-setup.md) Parts 1–3. You finish holding three values:

| Value | Looks like |
|---|---|
| `SLACK_BOT_TOKEN` | `xoxb-…` |
| `SLACK_ALARM_CHANNEL_ID` | `C0123ABCDEF` |
| `SLACK_REPORT_CHANNEL_ID` | `C0123ABCDEF` (optional) |

Do not paste the token anywhere except Vercel's environment variables.

## Part B — Generate the two secrets

```bash
openssl rand -hex 32   # → CRON_SECRET
openssl rand -hex 32   # → MONITOR_TOKEN
```

Keep both. `CRON_SECRET` goes into Vercel **and** GitHub Actions. `MONITOR_TOKEN` goes into Vercel **and** sentinel-gateway — the same value in both places, or the aggregate probe 401s.

## Part C — Create the database

Vercel dashboard → **Storage** → **Create Database** → **Neon** → free tier → connect it to the sentinel-observ project (create the project first if Vercel asks). Vercel injects `DATABASE_URL` automatically.

There is **no migration to run.** The schema is idempotent DDL in `lib/schema.ts` and is applied on the first tick.

## Part D — Create the Vercel project

1. Vercel → **Add New** → **Project** → **Import Git Repository** → `Fortiqo-network/sentinel-observ`.
2. Framework Preset: **Next.js** (auto-detected). Root Directory `./`. Leave build and install commands at their defaults.
3. Deploy. The first build succeeds with no environment variables at all — the dashboard comes up in live-probe-only mode and shows a setup checklist naming what is still missing.

## Part E — Set the environment variables

Project → **Settings** → **Environment Variables**. Add each for **Production** (and Preview if you want previews to alert, which you usually do not):

| Name | Value |
|---|---|
| `CRON_SECRET` | from Part B |
| `MONITOR_TOKEN` | from Part B |
| `GATEWAY_URL` | `https://sentinel-api.fortiqo.xyz` |
| `SLACK_BOT_TOKEN` | `xoxb-…` from Part A |
| `SLACK_ALARM_CHANNEL_ID` | `C…` from Part A |
| `SLACK_REPORT_CHANNEL_ID` | `C…` from Part A (optional) |
| `DASHBOARD_URL` | `https://monitor.fortiqo.xyz` |
| `DATABASE_URL` | injected by Neon in Part C — do not add by hand |

Then **Deployments → ⋯ → Redeploy**. Environment variables are read at boot; an already-running deployment will not pick them up.

## Part F — Point monitor.fortiqo.xyz at it

1. Vercel project → **Settings** → **Domains** → **Add** → `monitor.fortiqo.xyz`.
2. Vercel shows the record it wants: `CNAME monitor → cname.vercel-dns.com`.
3. Cloudflare → the **fortiqo.xyz** zone → **DNS** → **Add record**:

   | Field | Value |
   |---|---|
   | Type | `CNAME` |
   | Name | `monitor` |
   | Target | `cname.vercel-dns.com` |
   | Proxy status | **DNS only** (grey cloud) |
   | TTL | Auto |

   **The grey cloud matters.** With the orange proxy on, Cloudflare terminates TLS itself, which can block Vercel from issuing and auto-renewing the certificate, and puts two CDNs in series for no benefit. This is the same configuration the other `*.fortiqo.xyz` Vercel projects use.
4. Back in Vercel, wait for the domain to flip to **Valid Configuration** and the certificate to issue (usually under a minute).
5. Confirm: `curl -I https://monitor.fortiqo.xyz` → `200`.

## Part G — GitHub Actions secrets (the scheduler)

Vercel Cron on the Hobby plan only fires once per day, so the 5-minute cadence comes from this repo's own workflow.

GitHub → `Fortiqo-network/sentinel-observ` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Value |
|---|---|
| `CRON_SECRET` | the same value as in Vercel |
| `OBSERV_URL` | `https://monitor.fortiqo.xyz` |

Then **Actions** → **monitor** → **Run workflow** → job `check` to fire one immediately instead of waiting for the schedule.

> **Deployment Protection gotcha.** If the Vercel project has Deployment Protection enabled on Production, the scheduler's `curl` receives a Vercel SSO login page instead of the endpoint, and the workflow fails with a 401. Either disable protection for Production (the dashboard is read-only, and `/api/cron/*` has its own `CRON_SECRET` auth) or add a Protection Bypass token to the workflow's request.

> **Actions idles off.** GitHub disables scheduled workflows in a repository with 60 days of no commits. A repo that only runs crons will silently stop; re-enable it from the Actions tab, or push any commit.

## Part H — Mirror MONITOR_TOKEN into the gateway

Until this is done, the five internal services show as *not monitored* — the gateway's aggregate endpoint returns 503 because it fails closed.

**Order matters.** Add the secret first, then the workflow line — a deploy with the variable referenced but unset would write an empty value.

1. GitHub → `Fortiqo-network/sentinel-gateway` → **Settings** → **Secrets and variables** → **Actions** → new secret `MONITOR_TOKEN`, the value from Part B.
2. Edit `.github/workflows/deploy.yml` in that repo:
   - in the job's `env:` block, add `MONITOR_TOKEN: ${{ secrets.MONITOR_TOKEN }}`
   - inside the `{ … } > .env.production` heredoc, before the closing brace, add
     `if [ -n "${MONITOR_TOKEN}" ]; then echo "MONITOR_TOKEN=${MONITOR_TOKEN}"; fi`
     (guarded, so a missing secret degrades to today's behaviour rather than writing a blank)
3. Commit as `ci: persist MONITOR_TOKEN into .env.production on deploy` and push — the triggered redeploy validates the fix.

Editing the runner's `.env.production` directly works immediately but is **wiped by the next deploy**, because the workflow regenerates that file from secrets. See [07-operations-notes.md](07-operations-notes.md).

## Part I — Verify, in this order

```bash
# 1. The site is live on the domain
curl -sI https://monitor.fortiqo.xyz | head -1

# 2. Slack credentials work and the bot is in the channel
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://monitor.fortiqo.xyz/api/slack/test
# → {"ok":true,...} and a 🟢 message lands in #sentinel-alarms

# 3. The gateway aggregate endpoint answers (after Part H)
curl -s -H "X-Monitor-Token: $MONITOR_TOKEN" \
  https://sentinel-api.fortiqo.xyz/internal/monitor/health
# → {"checked_at":"…","services":{"core-api":{"ok":true,…},…}}

# 4. A full tick: probes, persists, alerts
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://monitor.fortiqo.xyz/api/cron/check
# → "persisted":true, "up":7, "total":7

# 5. The public snapshot agrees
curl -s https://monitor.fortiqo.xyz/api/status
```

Then open https://monitor.fortiqo.xyz. The amber **setup checklist panel disappears** once all four capabilities are wired — that panel is the fastest way to see what is still missing.

## Part J — The real test

Pick a quiet moment. On the runner box:

```bash
docker stop sentinel-billing
# within one tick (≤ ~6 min) a 🔴 lands in #sentinel-alarms
docker start sentinel-billing
# next tick → 🟢 threaded under the alarm, with the correct downtime
```

That is the only test that proves the whole chain — probe, state machine, database, Slack — actually works. Until it has been run, treat alerting as unproven.

---

## Who can see the dashboard

`monitor.fortiqo.xyz` is **public and read-only**. It exposes service names, uptime, latency and failure reasons — no credentials, no request bodies, no user data. Pages are served `noindex`, so it will not appear in search results.

If you want it private, either turn on Vercel **Password Protection** (Settings → Deployment Protection) or put **Cloudflare Access** in front of the hostname. Do not put auth in front of `/api/cron/*` that way — those routes already authenticate with `CRON_SECRET`, and a login wall would break the scheduler.
