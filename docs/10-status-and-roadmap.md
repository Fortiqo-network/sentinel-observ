# 10 — Status, scope & roadmap

Last updated **2026-07-29**. The single place that answers: what works, what is proven, what is left, and what is deliberately not being built.

Rule for this document: **nothing is listed as done unless it has been observed working.** Where something is built but unproven, it says so.

---

## 1. Current state

Live at **https://monitor.fortiqo.xyz** — private, password-protected, excluded from search indexes.

| Capability | State | Evidence |
|---|---|---|
| Service probing | ✅ live | 7/7 up; `config.aggregate = true` |
| Postgres persistence | ✅ live | Neon connected; schema auto-created; ticks writing |
| Alert state machine | ⚠️ built, **never fired on a real outage** | `baseline` → `still_up` transitions observed |
| Slack alerting | ✅ connected | messages delivered to `C0BKP4MKSGK` |
| Daily / weekly reports | ✅ live | `daily` + `weekly` runs recorded, `posted=1`, no errors |
| Reports exactly-once | ✅ fixed + verified | 10 concurrent claimants → exactly 1 winner |
| Dashboard | ✅ live | overview, per-service, incidents, analytics |
| Password gate | ✅ live | wrong password 401, no cookie 307 |
| Storage guard | ✅ built + validated | rollup invariance proven on live Neon |
| Money-path monitoring | ⚠️ shipped, **unproven** | schema + transitions validated; no real fault has triggered it |
| ChatOps deploys | ⚠️ shipped, **dormant** | endpoints live (405 on GET); env vars + Slack app config not set |
| Traffic analytics | ⚠️ shipped, **not receiving data** | frontend env vars not set |
| Scheduler | ❌ **unreliable** | **12 ticks in 24 h, of ~288 expected** |

**The one number that is still wrong:** detection latency. Designed for ≤6 minutes, currently **1–2 hours**, because GitHub Actions drops most of the 5-minute schedule. Everything else is either working or waiting on a config value. See §3.1.

---

## 2. What is built

### 2.1 sentinel-observ (this repo)

**Probe engine** (`lib/probe.ts`) — 3 attempts 3 s apart before a service counts as DOWN (8 s timeout direct, 15 s aggregate), so a single blip never pages anyone. Failure reasons are normalized into actionable sentences. Distinguishes **down** from **unknown**: a monitor that cannot see a service must never claim it is broken.

**Data layer** (`lib/db.ts`, `lib/schema.ts`, `lib/repo.ts`) — eleven tables, idempotent DDL applied automatically, so there is no migration step and code can never run ahead of schema. Every query validated against live Neon Postgres 17.

**Alert state machine** (`lib/state.ts`) — pure, no I/O. Alerts fire on *transitions*, which makes a tick idempotent: double-fired or late runs produce no duplicate alerts.

**Storm suppression** — gateway down plus ≥2 internal services collapses into ONE platform-outage alert. They share one machine, so that pattern is one root cause.

**Slack** — 🔴 down (service, reason, since, last-seen-up, impact, first debug command), 🚨 platform outage, ⏰ reminders at 30 min then hourly, 🟢 threaded recovery, 💸 money-path degraded, 💚 recovered, 🚀 deploy triggered. Undelivered alerts retry on the next tick.

**Reports** (`lib/jobs.ts`, `lib/report.ts`) — daily and weekly as a **thread**: one verdict line in the channel, breakdown in replies (service health, unhealthy timeline with exact times and recovery durations, MTTR, traffic, storage). **Exactly-once per period**, guarded by an overdue check *and* an atomic claim — a late scheduled call racing the health tick previously produced two reports for the same day. Any tick after the 03:30 UTC anchor produces an overdue report, so a dropped schedule delays rather than loses it.

**Dashboard** — overview (status hero, KPI tiles, service grid with sparklines, 24 h latency chart, 90-day uptime bars, incidents, money path, deploys, monitor self-health, storage, metrics table), `/services/[id]`, `/incidents`, `/analytics`. Every bar chart has a hover readout.

**Access control** (`middleware.ts`, `lib/password.ts`) — PBKDF2-SHA256 (210k iterations) over edge WebCrypto; HMAC-signed session cookie keyed from the password hash, so changing the password invalidates every session. Fails closed. Machine endpoints are exempt because they carry their own stronger auth.

**Storage guard** (`lib/storage.ts`) — measures `pg_database_size()` and tightens retention across four tiers toward the 500 MB ceiling. Rollups are never pruned, so tightening costs detail, never history. `VACUUM (ANALYZE)` after pruning.

**Traffic analytics** — counted server-side in the frontend's edge middleware, because a developer audience blocks client-side analytics heavily. No IP, cookie, user agent or user id stored.

**Money-path monitoring** (`lib/money.ts`) — §2.4.

**ChatOps deploys** (`lib/deploy.ts`, `lib/slack-verify.ts`) — §2.5.

**Meta-monitoring** — `monitor_runs` records every job; the dashboard shows delivered-vs-expected ticks; the workflow posts to Slack if it cannot run at all.

### 2.2 sentinel-gateway

- `GET /internal/monitor/health` — token-protected concurrent fan-out to the five internal services.
- `GET /internal/monitor/money` — relays billing's money-path health, presenting `INTERNAL_SERVICE_TOKEN` upstream so observ never holds a billing credential.
- Both fail closed, bypass rate limiting and metering. `deploy.yml` persists `MONITOR_TOKEN`.

### 2.3 sentinel-frontend

- Edge middleware reports every page view, fire-and-forget, never able to fail a page.
- Matcher broadened to all pages for the beacon; portal guard scoped by path so it still applies to exactly `/dashboard`, `/seller`, `/admin`. Five tests lock that in.

### 2.4 sentinel-billing

`GET /v1/ops/money-health` — metering stream backlog (depth, unacked, oldest-unacked age, consumer count), stranded settlements (RESERVED past `settlement_ttl_hours`, DELIVERED past 2× the confirm window, CONFIRMED past 2 h), and `?deep=true` ledger reconciliation.

**Why:** liveness probes cannot see a dead metering consumer (calls execute, nobody is billed) or a stalled settlement reaper (funds held, sellers unpaid). Both look perfectly healthy on a service dashboard.

### 2.5 ChatOps deploys

`/deploy` in Slack posts an ephemeral picker; a confirmed button dispatches that service's existing `deploy.yml` on `main`. No changes were needed in the service repos — all six already accept `workflow_dispatch`.

**This is the only part of the system that can change production.** Perimeter: Slack request-signature verification with a 5-minute replay window, plus a `SLACK_DEPLOY_ALLOWLIST` of user ids — a valid signature only proves the request came from Slack, and anyone in a shared channel can click a button. Every attempt is recorded, refusals included. Verified: unsigned, replayed, tampered-body and wrong-secret requests all rejected; unauthorised clicks refused without dispatching.

**Why it lives here rather than as a standalone bot:** because this app also watches the services, an outage alert can say *"deployed 4 minutes before this outage — rolling back is likely faster than debugging."* No deploy-notification integration can say that, because it does not know an outage happened. Deploy-failure notifications themselves are left to GitHub's own Slack app, which already does them well.

---

## 3. Pending — operator actions

None require code.

### 3.1 Add a reliable cron trigger — **the only thing that still matters**

GitHub Actions delivers ~5% of scheduled ticks. Until this is fixed, an outage can run for an hour before anyone hears about it.

[cron-job.org](https://cron-job.org) (free, 1-minute resolution, custom headers):

```
URL      https://monitor.fortiqo.xyz/api/cron/check
Method   POST
Header   Authorization: Bearer <CRON_SECRET>
Every    5 minutes
```

Keep the GitHub workflow as a backstop — the tick is idempotent, so overlapping triggers are harmless.

**Done when:** `monitor_runs` shows ~288 `check` rows per day.

### 3.2 Enable ChatOps deploys

Four env vars on this project (`SLACK_SIGNING_SECRET`, `SLACK_DEPLOY_ALLOWLIST`, `GITHUB_TOKEN`, `GITHUB_ORG`) plus two Slack app URLs. Full walkthrough: [docs/11](11-chatops-deploys.md). Dormant and fail-closed until then.

### 3.3 Turn on traffic collection

`OBSERV_INGEST_URL` and `OBSERV_INGEST_TOKEN` on the **sentinel-frontend** Vercel project. **Done when:** the hourly chart on `/analytics` is non-zero.

### 3.4 Rotate every credential

Slack bot token, Neon password, `CRON_SECRET`, `MONITOR_TOKEN`, `INGEST_TOKEN`, dashboard password — all passed through a chat transcript. Nothing is known to be compromised; this is hygiene. Order matters for paired values ([docs/09 §6](09-secrets-and-vercel.md)).

### 3.5 Prove the outage alert path

```bash
docker stop sentinel-billing     # expect 🔴 within one tick
docker start sentinel-billing    # expect 🟢 threaded, correct duration
```

**The only test that proves the whole chain.** Until it runs, treat alerting as unproven.

### 3.6 Prove the money-path alert

Stop the billing Celery worker, push a metered call through, wait one tick: expect 💸, then 💚 on restart.

### 3.7 Optional: Vercel function region

`iad1` → `bom1` puts probes closer to the backend. Cosmetic.

---

## 4. Pending — engineering, in scope

Ranked by value per unit of effort.

### 4.1 Seller agent fleet health — **the biggest remaining blind spot**

Everything built so far watches **Sentinel's** services. Sentinel's *product* is other people's agents on other people's infrastructure, and nothing watches those.

If 30% of live agents start returning 502s, this dashboard stays 7/7 green while the marketplace is functionally broken: buyers get failures, sellers earn nothing, and pay-on-outcome means the platform earns nothing either. You would find out from a support ticket.

Measure aggregate call success rate across live agents (alert on a *drop*, not an absolute), plus a per-agent breakdown to separate one bad seller from a systemic fault. The data likely already exists — the gateway meters every `/use` call and settlement states encode delivered vs failed — so this may be closer to an aggregation than new instrumentation.

*Effort: ~1 day. Start by reading how the gateway meters calls, as was done for the money path.*

### 4.2 Business-outcome anomaly detection

Threshold alerts catch loud failures. The dangerous ones are quiet: a frontend deploy breaks the "Use agent" button, an auth regression blocks logins, a pricing bug makes every call 402.

*"Zero successful calls in the last hour, when the same hour last week had 40"* catches all of those, and no health check ever will. Compare against the same window a week earlier rather than a fixed threshold, so it survives growth and weekly seasonality. Same shape for signups and top-ups.

*Effort: ~1 day.*

### 4.3 Synthetic paid transaction

Everything so far proves the platform is **up**. Nothing proves it **works**. A canary agent invoked through the real `/v1/agents/{seller}/{slug}/use` path with a test account, asserting it executes, charges the right credits, and settles.

*Effort: 1–2 days. Needs a canary seller/agent and a funded test account.*

### 4.4 TLS certificate & domain expiry — **best value per hour**

An expired certificate or lapsed domain takes the whole platform down and nothing watches either. Read the peer certificate's `notAfter` during the existing probe; alert at 21/7/1 days.

*Effort: ~2 hours.*

### 4.5 Trust-score freshness

The product's central claim is *independently verified* agents. If the verify pipeline stalls, scores do not go wrong — they go **stale**, which is worse, because a stale score still looks authoritative while the agent drifts underneath it. Measure oldest score age among live agents and the share verified within the intended window. Also guard against *mass* score movement, which means a scoring bug shipped.

*Effort: ~½ day, needs a read endpoint in verify or core-api.*

### 4.6 Gateway error-rate signal

A gateway returning 500 on 30% of requests passes `/health` perfectly.

*Effort: ~½ day.*

### 4.7 Celery worker liveness

verify's workers have no HTTP surface. Extending its health endpoint with `celery inspect ping` would let the existing aggregate pick it up for free.

*Effort: ~½ day, mostly in sentinel-verify.*

### 4.8 Backup freshness

For a system holding a credits ledger this is existential, and the ops board already lists a tested restore as pending. Monitoring cannot run the drill, but it can assert "the last successful backup is under 24 h old" — which is the part that silently stops being true.

*Effort: ~½ day once a backup job exists to observe.*

### 4.9 Direct Postgres / Redis checks

Currently inferred from service health. A direct depth check in the aggregate would separate "the app is broken" from "its datastore is broken" in the first alert.

*Effort: ~½ day.*

### 4.10 Escalation

`@here` when an incident passes 30 minutes; optionally a phone-level path for platform outages.

*Effort: ~1 hour.*

### 4.11 Public status page

A sanitised read-only view at `status.fortiqo.xyz`, distinct from this dashboard which is deliberately private.

*Effort: ~1 day, mostly decisions about what to expose.*

### 4.12 Meta-monitor

An external ping (UptimeRobot free) on monitor.fortiqo.xyz itself. The workflow's failure alert covers "the scheduler could not run", not "the monitor is up and lying".

*Effort: ~15 minutes.*

---

## 5. Explicitly out of scope

Not oversights — deliberate boundaries.

| Not building | Why |
|---|---|
| APM / tracing / log search | Sentry and friends do this better. This app answers "is it working and is money moving?" |
| Deploy-failure notifications | GitHub's Slack app already does it. Only *correlation* with outages was worth building |
| Admin/maintenance controls | The Sentinel admin console already has these, with a real auth model |
| Rollback, per-environment deploys, approval chains | A Slack allowlist is not an authorisation model. Belongs in the admin console |
| Per-user or per-agent product analytics | Belongs in the product. This stores no identifiers on purpose |
| Writing to any running Sentinel service | Read-only, with ChatOps deploys as the single audited exception |

---

## 6. Known limitations

1. **Detection latency is scheduler-bound.** §3.1. The uptime math is immune — a missed tick records as a gap, never as fake downtime — but detection is only as fast as the trigger.
2. **The outage alert path has never fired in production.** §3.5.
3. **Money-path monitoring is unproven.** §3.6.
4. **ChatOps deploys are dormant.** §3.2.
5. **Traffic analytics is not collecting.** §3.3.
6. **Referrer and country history is bounded by raw retention** — only paths are rolled up.
7. **One Slack channel.** Reports and alarms share `C0BKP4MKSGK`, so a busy report can push an alarm up the scroll.
8. **`deep=true` reconciliation is manual** — deliberately off the 5-minute tick, and not yet wired into the daily report.
9. **Deploys made directly in GitHub are not recorded**, so outage correlation only covers deploys triggered from Slack.

---

## 7. Verifying any of this yourself

```bash
# Live status (log in first)
curl -s -c c.txt -X POST -H 'Content-Type: application/json' \
  -d '{"password":"..."}' https://monitor.fortiqo.xyz/api/auth/login
curl -s -b c.txt https://monitor.fortiqo.xyz/api/status

# Force a tick (also produces any overdue report)
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://monitor.fortiqo.xyz/api/cron/check

# Slack credentials, and a sample report thread
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://monitor.fortiqo.xyz/api/slack/test
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://monitor.fortiqo.xyz/api/slack/test?report=1"

# Internal services, and the money path, straight from the gateway
curl -s -H "X-Monitor-Token: $MONITOR_TOKEN" \
  https://sentinel-api.fortiqo.xyz/internal/monitor/health
curl -s -H "X-Monitor-Token: $MONITOR_TOKEN" \
  https://sentinel-api.fortiqo.xyz/internal/monitor/money
```

The one worth checking weekly:

```sql
SELECT date_trunc('day', ran_at) AS day, kind, COUNT(*)
FROM monitor_runs GROUP BY 1, 2 ORDER BY 1 DESC;
-- expect ~288 'check' rows/day, exactly 1 'daily', 1 'weekly' per week
```
