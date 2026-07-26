# 06 — Implementation status & go-live checklist

Build order was: script → gateway endpoint → probe engine → Slack alerts → summaries → dashboard. All of it is written; what is left is configuration.

## Shipped

### Step 1 — Standalone probe script ✅
`scripts/probe.mjs` — zero-dependency Node checker. Validated 7/7 services up on 2026-07-26 and immediately caught a real `sentinel-runtime` crash loop (doc 07).

```bash
node scripts/probe.mjs            # from the server: checks all 7
node scripts/probe.mjs --public   # from anywhere: gateway + frontend only
```

### Step 2 — Gateway aggregate endpoint ✅ (`sentinel-gateway`)
`GET /internal/monitor/health` in `routers/monitor.py`: requires `X-Monitor-Token`, fans out concurrently to the five internal health endpoints with a 3 s timeout each, returns `{checked_at, services:{id:{ok,status,latency_ms,error}}}`. Registered in `main.py` and added to the rate-limit and metering bypass lists, like `/health`. Fails closed — with `MONITOR_TOKEN` unset it returns 503, never unauthenticated data. Tests: `tests/test_monitor.py` (4). Gateway suite 107/107, ruff clean, no new mypy errors.

### Step 3 — Probe engine + persistence ✅
`lib/probe.ts` (3 attempts 3 s apart, normalized failure reasons per doc 04), `lib/db.ts` + `lib/schema.ts` (self-applying idempotent DDL), `lib/repo.ts` (every query), `lib/state.ts` (pure transition logic), `lib/tick.ts` (probe → persist → decide → alert). `POST /api/cron/check` is `CRON_SECRET`-guarded with `maxDuration: 60`.

### Step 4 — Slack alerting ✅
`lib/slack.ts` (one `fetch`, never throws) + `lib/messages.ts` (Block Kit payloads for down / storm / recovery / reminder / daily / weekly). Storm suppression, threaded recoveries, 30-then-60-minute reminders, and `alert_pending`/`recovery_pending` retry are all wired. `GET /api/slack/test` verifies credentials without waiting for an outage.

### Step 5 — Scheduler ✅
`.github/workflows/monitor-tick.yml` — one workflow, three schedules (`*/5 * * * *` check, `30 3 * * *` daily, `30 3 * * 1` weekly; UTC, so 09:00 IST) plus `workflow_dispatch` to run any of them by hand.

### Step 6 — Summaries ✅
`lib/rollup.ts` (uptime from incident spans, latency percentiles, MTTR, longest incident, missed-tick detection) behind `/api/cron/daily` (report + rollup write + 90-day prune) and `/api/cron/weekly` (report + week-over-week trend).

### Step 7 — Dashboard ✅
Dark cinematic UI on the sentinel-frontend design tokens (ink/porcelain/gold, Archivo + IBM Plex Mono, the Tessera mark).

- `/` — status hero, four KPI tiles, service grid with sparklines, 24-hour multi-series latency chart, 90-day uptime bars per service, incident log, monitor self-health, per-service metrics table.
- `/services/[id]` — live probe, uptime at three horizons, latency chart, 90-day bars, incident history, runbook (endpoint, impact, first command), raw check log.
- `/incidents` — full log with MTTR, worst outage, most-affected service.
- `GET /api/status` — the same data as JSON.
- Auto-refresh every 60 s (paused while the tab is hidden), plus a manual refresh control.
- A **setup checklist panel** names the exact env vars for anything not yet configured, and disappears once everything is wired.

## Remaining — configuration only

- [ ] **Slack app + channels + token** → doc 03, Parts 1–5.
- [ ] **Neon Postgres** → Vercel → Storage → Create → Neon (free tier) → `DATABASE_URL`. No migration to run.
- [ ] **Secrets** → `openssl rand -hex 32` twice → `CRON_SECRET`, `MONITOR_TOKEN`.
- [ ] **`MONITOR_TOKEN` into sentinel-gateway.** Per doc 07 this must be a **GitHub repository secret + a `deploy.yml` env line** — editing a local env file does not survive a redeploy.
- [ ] **Vercel env vars** for this project (table in doc 05) → redeploy.
- [ ] **GitHub Actions secrets** in this repo: `CRON_SECRET`, `OBSERV_URL`.
- [ ] **Verify the database path** — the query layer has not yet run against a live Postgres. The first successful `/api/cron/check` with `DATABASE_URL` set is the proof; check that `checks` and `monitor_runs` have rows.
- [ ] **Fire a real outage test** — `docker stop sentinel-billing` on the server; within one tick a 🔴 lands in `#sentinel-alarms`; `docker start` → 🟢 threaded reply with the right duration. Do it in a quiet moment: it is a real ~5-minute billing outage.

## Acceptance checklist

- [ ] Killing any one backend container produces a correct 🔴 alert in ≤ ~6 min and a 🟢 threaded recovery after restart, with accurate duration.
- [ ] Killing the gateway (or the box) produces ONE 🚨 platform-outage alert, not six.
- [ ] Daily report arrives with uptime numbers that match the incident log.
- [ ] Weekly report arrives Monday with trend + MTTR.
- [ ] Dashboard shows live status + history, and the setup checklist panel is gone.
- [ ] No secrets in the repo; `/api/cron/*` rejects unauthenticated calls; the gateway aggregate endpoint rejects a missing token.

## Phase 3 backlog

- `sentinel-frontend` `/api/health` route so the probe does not depend on the homepage rendering.
- Celery worker/beat liveness surfaced through verify's health endpoint (doc 02).
- Direct Postgres/Redis checks inside the gateway aggregate.
- Escalation: `@here` when an incident passes 30 minutes.
- Maintenance-mode toggle (the `maintenance` status is already honoured by the state machine; only the admin UI to set it is missing).
- Public status page at `status.fortiqo.xyz`.
- Meta-monitoring: a free UptimeRobot ping on this app — who watches the watcher.
