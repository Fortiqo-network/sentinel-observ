# 10 — Status, scope & roadmap

Last updated **2026-07-28**. The single place that answers: what works, what is proven, what is left, and what is deliberately not being built.

Rule for this document: **nothing is listed as done unless it has been observed working.** Where something is built but unproven, it says so.

---

## 1. Current state

Live at **https://monitor.fortiqo.xyz** — private, password-protected, excluded from search indexes.

| Capability | State | Evidence |
|---|---|---|
| Service probing | ✅ live | 7/7 services up; `config.aggregate = true` |
| Postgres persistence | ✅ live | Neon connected; schema auto-created; ticks writing |
| Alert state machine | ⚠️ built, never fired in anger | `baseline` → `still_up` transitions observed in production |
| Slack alerting | ✅ connected | test message + sample thread delivered to `C0BKP4MKSGK` |
| Daily / weekly reports | ✅ live | `daily` 06:06 UTC and `weekly` 07:00 UTC on 2026-07-28, `posted=1`, no errors |
| Dashboard | ✅ live | overview, per-service, incidents, analytics |
| Password gate | ✅ live | `@echooff`; wrong password 401, no cookie 307 |
| Storage guard | ✅ built + validated | rollup invariance proven against live Neon |
| Traffic analytics | ⚠️ code shipped, **not receiving data** | frontend env vars not set yet |
| Money-path monitoring | ⚠️ shipped, unproven | schema + transition logic validated on Neon; never triggered by a real fault |
| Scheduler | ❌ **unreliable** | 12 of ~228 expected ticks in 19 h |

**The one number that matters and is currently wrong:** detection latency. Designed for ≤6 minutes, currently **1–2 hours**, because GitHub Actions drops most of the 5-minute schedule. See §4.1.

---

## 2. What is built

### 2.1 sentinel-observ (this repo)

**Probe engine** (`lib/probe.ts`) — 3 attempts 3 s apart before a service counts as DOWN (8 s timeout direct, 15 s aggregate), so a single blip never pages anyone. Failure reasons are normalized into sentences an operator can act on (`connection refused ×3 attempts — process or host is down`). Distinguishes **down** from **unknown**: a monitor that cannot see a service must never claim it is broken.

**Data layer** (`lib/db.ts`, `lib/schema.ts`, `lib/repo.ts`) — eight tables, idempotent DDL applied automatically on first use, so there is no migration step and code can never run ahead of the schema. Every query validated against live Neon Postgres 17.

**Alert state machine** (`lib/state.ts`) — pure, no I/O, so the transition rules are testable in isolation. Alerts fire on *transitions*, which makes a tick idempotent: double-fired or late runs produce no duplicate alerts.

**Storm suppression** — gateway down plus ≥2 internal services collapses into ONE platform-outage alert. They share one machine, so that pattern is a single root cause, and six alerts for one cause trains people to ignore the channel.

**Slack** (`lib/slack.ts`, `lib/messages.ts`) — 🔴 down (service, reason, since, last-seen-up, user impact, first debug command), 🚨 platform outage, ⏰ reminders at 30 min then hourly, 🟢 threaded recovery with exact downtime, 💸 money-path degraded, 💚 recovered. Undelivered alerts stay flagged and retry on the next tick, so a Slack outage cannot lose one.

**Reports** (`lib/jobs.ts`, `lib/report.ts`) — daily and weekly, posted as a **thread**: one verdict line in the channel, breakdown in replies (service health, unhealthy timeline with exact times and recovery durations, MTTR, traffic, storage). Overdue reports are produced by any health tick, so a dropped schedule delays them rather than losing them.

**Dashboard** — overview (status hero, KPI tiles, service grid with sparklines, 24 h latency chart, 90-day uptime bars, incidents, monitor self-health, storage, money path, per-service metrics table), `/services/[id]` drill-down with runbook and raw check log, `/incidents`, `/analytics`. Every bar chart has a hover readout. Auto-refresh every 60 s, paused while the tab is hidden.

**Access control** (`middleware.ts`, `lib/password.ts`) — PBKDF2-SHA256 (210k iterations), edge-runtime WebCrypto, HMAC-signed session cookie whose key derives from the password hash, so changing the password invalidates every session. Fails closed. `/api/cron/*`, `/api/slack/*` and `/api/ingest/*` are exempt because they carry their own stronger auth and are called by systems that cannot fill in a login form.

**Storage guard** (`lib/storage.ts`) — measures `pg_database_size()` and tightens retention across four tiers as usage climbs toward the 500 MB free-tier ceiling. Rollups are never pruned, so tightening costs detail, never history. `VACUUM (ANALYZE)` after pruning, or the space never returns.

**Traffic analytics** — counted server-side in sentinel-frontend's edge middleware, not in the browser, because a developer audience blocks client-side analytics heavily. No IP, cookie, user agent or user id is stored.

**Money-path monitoring** (`lib/money.ts`) — see §2.4.

**Meta-monitoring** — `monitor_runs` records every job; the dashboard shows delivered-vs-expected ticks; the scheduler workflow posts to Slack if it cannot run at all.

### 2.2 sentinel-gateway

- `GET /internal/monitor/health` — token-protected concurrent fan-out to the five internal services (3 s each). Exists because those services sit on a private Docker network an off-site monitor cannot reach. Returns only up/down/latency.
- `GET /internal/monitor/money` — relays billing's money-path health; presents `INTERNAL_SERVICE_TOKEN` upstream so observ never holds a billing credential.
- Both fail closed (503 with `MONITOR_TOKEN` unset), bypass rate limiting and metering.
- `deploy.yml` persists `MONITOR_TOKEN` into `.env.production` behind a guard.

### 2.3 sentinel-frontend

- Edge middleware reports every page view to observ, fire-and-forget via `waitUntil`, never able to fail a page.
- The matcher was broadened to all pages so the beacon sees all traffic; the portal guard was scoped by path so it still applies to exactly `/dashboard`, `/seller`, `/admin`. Five tests lock that in.

### 2.4 sentinel-billing

`GET /v1/ops/money-health` (internal-token guarded, read-only, no per-user data):

- **Metering backlog** — stream depth, unacked count, oldest-unacked age, consumer count on the `billing-metering` group.
- **Stranded settlements** — RESERVED past `settlement_ttl_hours`, DELIVERED past 2× `settlement_confirm_window_hours`, CONFIRMED past 2 h, plus counts per state and total held units.
- **Ledger drift** — `?deep=true` runs the existing `reconcile_settlements` invariants.

Thresholds derive from the settings that drive the state machine, so retuning it retunes the monitoring.

**Why this exists:** liveness probes answer "is the process running?" Two failures pass every one of them — a dead metering consumer (calls execute, nobody is billed) and a stalled settlement reaper (buyer funds held, sellers unpaid). Both look perfectly healthy on a service dashboard.

---

## 3. Pending — operator actions

Ordered by impact. None require code.

### 3.1 Add a reliable cron trigger — **highest impact**

GitHub Actions delivers ~5% of the scheduled ticks. Until this is fixed, an outage can run for an hour before anyone hears about it.

[cron-job.org](https://cron-job.org) (free, 1-minute resolution, supports custom headers):

```
URL      https://monitor.fortiqo.xyz/api/cron/check
Method   POST
Header   Authorization: Bearer <CRON_SECRET>
Every    5 minutes
```

Keep the GitHub workflow as a backstop — the tick is idempotent, so overlapping triggers are harmless.

**Done when:** `monitor_runs` shows ~288 `check` rows per day.

### 3.2 Turn on traffic collection

`/analytics` will stay empty until the **sentinel-frontend** Vercel project has:

```
OBSERV_INGEST_URL    https://monitor.fortiqo.xyz/api/ingest/pageview
OBSERV_INGEST_TOKEN  <same value as INGEST_TOKEN in observ>
```

Production scope, then redeploy. **Done when:** the hourly chart on `/analytics` is non-zero.

### 3.3 Rotate every credential

All of these passed through a chat transcript: Slack bot token, Neon password, `CRON_SECRET`, `MONITOR_TOKEN`, `INGEST_TOKEN`, dashboard password. Nothing is known to be compromised — this is hygiene.

Order matters for the paired ones (§6 of doc 09). Rotating the dashboard password also invalidates every session, by design.

### 3.4 Prove the alert path — induced outage

The state machine has never fired on a real outage. In a quiet moment, on the runner box:

```bash
docker stop sentinel-billing     # expect 🔴 within one tick
docker start sentinel-billing    # expect 🟢 threaded, correct duration
```

**This is the only test that proves the whole chain.** Until it runs, treat alerting as unproven.

### 3.5 Prove the money-path alert

```bash
# stop the billing Celery worker, push a metered call through, wait one tick
# expect 💸 MONEY PATH DEGRADED; restart → 💚 recovered
```

### 3.6 Optional: move the Vercel function region

Currently `iad1` (Washington DC) — every probe crosses the Atlantic twice. `bom1` (Mumbai) is closer to the backend, so latency figures reflect the real network path and spurious timeouts are less likely. Cosmetic, not functional.

---

## 4. Pending — engineering, in scope

Ranked by value per unit of effort.

### 4.1 Synthetic paid transaction — **the biggest remaining gap**

Everything built so far proves the platform is **up**. Nothing proves it **works**. A canary agent invoked through the real `/v1/agents/{seller}/{slug}/use` path with a test account, asserting that it executes, charges the right credits, and settles.

This is the only check that would catch "all services green, but every call 500s at the last hop" or "calls succeed but the charge is wrong".

*Effort: 1–2 days. Needs a canary seller/agent and a funded test account.*

### 4.2 Gateway error-rate signal

A gateway returning 500 on 30% of requests passes `/health` perfectly. Needs a rolling error-rate counter surfaced through the monitor endpoint, with an alert above a threshold.

*Effort: ~½ day.*

### 4.3 TLS certificate & domain expiry

An expired certificate or lapsed domain takes the whole platform down, and nothing currently watches either. Cheap to add to the probe engine: read the peer certificate's `notAfter`, alert at 21/7/1 days.

*Effort: ~2 hours. Best value-per-hour on this list.*

### 4.4 Celery worker liveness

`sentinel-verify`'s workers have no HTTP surface. Extending verify's health endpoint with `celery inspect ping` would let the existing aggregate pick it up for free. Same for billing's workers, which is what §3.5 tests manually.

*Effort: ~½ day, mostly in sentinel-verify.*

### 4.5 Direct Postgres / Redis checks

Currently inferred: every service's health check fails if its database is broken. A direct depth check inside the gateway aggregate would distinguish "the app is broken" from "its datastore is broken" in the first alert rather than after triage.

*Effort: ~½ day.*

### 4.6 Maintenance mode

The state machine already honours a `maintenance` status — it records checks and suppresses alerts. Only the admin UI to set it is missing.

*Effort: ~2 hours.*

### 4.7 Escalation

`@here` when an incident passes 30 minutes; optionally a second channel or a phone-level escalation for the platform-outage alert.

*Effort: ~1 hour.*

### 4.8 Public status page

A read-only, sanitised view at `status.fortiqo.xyz` for users. Distinct from this dashboard, which is deliberately private and shows internal detail.

*Effort: ~1 day, mostly copy and design decisions about what to expose.*

### 4.9 Meta-monitor

An external ping (UptimeRobot free) on monitor.fortiqo.xyz itself. The workflow's failure alert covers "the scheduler could not run", but not "the monitor is up and lying". Who watches the watcher.

*Effort: ~15 minutes.*

---

## 5. Explicitly out of scope

Not oversights — deliberate boundaries.

| Not building | Why |
|---|---|
| APM / tracing / log search | Sentry and friends do this better. This app answers "is it working and is money moving?" |
| Exception aggregation | Same. A monitor that becomes a log tool stops being a monitor |
| Per-user or per-agent analytics | Product analytics belongs in the product. This stores no identifiers on purpose |
| Writing to any Sentinel service | Read-only by design. If a change would let this app mutate platform state, it belongs elsewhere |
| Alerting on business metrics (revenue targets, signups) | Different question, different audience, different cadence |

---

## 6. Known limitations

1. **Detection latency is scheduler-bound.** §3.1. The uptime math is immune — a missed tick records as a gap, never as fake downtime — but detection is only as fast as the trigger.
2. **The alert path is unproven in production.** §3.4.
3. **Money-path monitoring is unproven.** §3.5. Schema and transition logic are validated; no real fault has triggered it.
4. **Traffic analytics is not collecting.** §3.2.
5. **Referrer and country history is bounded by raw retention.** Only paths are rolled up; keeping three dimensions would multiply rollup rows for much less analytical value.
6. **One Slack channel.** Reports and alarms share `C0BKP4MKSGK` until a second channel exists, so a busy report can push an alarm up the scroll.
7. **`deep=true` reconciliation is manual.** It loads every held row, so it is deliberately off the 5-minute tick. It is not yet wired into the daily report either.

---

## 7. Verifying any of this yourself

```bash
# Live status (needs a session cookie — log in first)
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

Scheduler health is the one worth checking weekly:

```sql
SELECT date_trunc('day', ran_at) AS day, kind, COUNT(*)
FROM monitor_runs GROUP BY 1, 2 ORDER BY 1 DESC;
-- expect ~288 'check' rows/day, 1 'daily', 1 'weekly' per week
```
