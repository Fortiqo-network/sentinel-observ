# 06 — Phase 2 implementation plan

Build order follows the requested sequence: **script first → Slack bot → realtime alerts → summaries → dashboard → hardening.** Each step ends runnable/testable on its own.

## Step 0 — Prerequisites (manual, ~15 min)

- [ ] Slack app + channels + token, per [doc 03](03-slack-bot-setup.md) baby steps (Parts 1–4, including the curl test).
- [ ] Create a Neon Postgres database (Vercel dashboard → Storage → Create → Neon, free tier) → `DATABASE_URL`.
- [ ] Generate secrets: `openssl rand -hex 32` twice → `CRON_SECRET`, `MONITOR_TOKEN`.

> **Progress (2026-07-26):** Step 1 is ✅ done and validated (7/7 up; found and hot-fixed a runtime crash loop — see doc 07). Step 3 is partially done: the Next.js skeleton (status page, `/api/probe`, guarded `/api/cron/check` stub, `lib/services.ts`, `lib/probe.ts`) exists and builds; DB layer and state machine are still pending. Further development is paused pending plan approval.

## Step 1 — Standalone probe script (already in repo) ✅

`scripts/probe.mjs` — zero-dependency Node script that probes what it can reach and prints a table. Run from the server (sees internal ports directly) or from anywhere (public URLs only):

```bash
node scripts/probe.mjs            # from the server: checks all 7
node scripts/probe.mjs --public   # from anywhere: gateway + frontend only
```

- [ ] Run it, confirm the current health-endpoint paths in doc 02 are correct (fix inventory if any 404s).

## Step 2 — Gateway aggregate endpoint (`sentinel-gateway` repo)

> Note (from doc 07): `MONITOR_TOKEN` must be added as a **GitHub secret + `deploy.yml` env line** in sentinel-gateway — editing local env files does not survive a redeploy.

- [ ] New router `monitor.py`: `GET /internal/monitor/health`, requires `X-Monitor-Token == settings.MONITOR_TOKEN`, concurrent `httpx` fan-out (3 s timeout each) to the 5 internal URLs from doc 02, returns the JSON shape from doc 01. Registered like `/readiness` (bypasses metering/rate-limit).
- [ ] Unit tests (mocked httpx) + add `MONITOR_TOKEN` to gateway env + compose prod env.
- [ ] Deploy via existing `deploy.yml`; verify: `curl -H "X-Monitor-Token: …" https://sentinel-api.fortiqo.xyz/internal/monitor/health`.

## Step 3 — Next.js app skeleton + probe engine

- [ ] `npx create-next-app@latest` (App Router, TS, Tailwind) in this repo.
- [ ] `lib/services.ts` (inventory), `lib/probe.ts` (direct + aggregate probes, 3×-retry rule), `lib/db.ts` + `migrations/001.sql` (doc 05 schema).
- [ ] `POST /api/cron/check`: auth → probe → write `checks` → state machine (`lib/state.ts`) → transitions list. `maxDuration: 60`.
- [ ] Local test: `.env.local`, `curl -X POST localhost:3000/api/cron/check -H "Authorization: Bearer …"` → rows appear.

## Step 4 — Slack alerting

- [ ] `lib/slack.ts` (doc 03) + `lib/messages.ts` building the Block Kit payloads from doc 04 (down / recovery-threaded / storm / reminders).
- [ ] Wire into the state machine incl. storm suppression + `pending_alerts` retry.
- [ ] **Test for real**: `docker stop sentinel-billing` on the server → within one tick a 🔴 lands in `#sentinel-alarms`; `docker start` → 🟢 threaded reply. (Do it in a quiet moment; it is a real 5-min outage of billing.)

## Step 5 — Deploy to Vercel + 5-min schedule

- [ ] Push repo → import in Vercel → set all env vars (doc 05 table).
- [ ] Add `.github/workflows/monitor-tick.yml` (doc 01) with `CRON_SECRET` as a GitHub Actions secret; three schedules: `*/5 * * * *` → check, `0 9 * * *` → daily, `0 9 * * 1` → weekly (cron is UTC — adjust hour for `TZ_REPORT`).
- [ ] Watch 2–3 ticks in the Actions tab + Vercel logs.

## Step 6 — Daily & weekly summaries

- [ ] `lib/rollup.ts` (uptime math, doc 05) + `/api/cron/daily` (writes `daily_rollups`, prunes checks >90 d, posts 📊) + `/api/cron/weekly` (7-day rollup + trend vs previous week, MTTR, longest incident, posts 📈).
- [ ] Test by invoking manually with curl before trusting the schedule.

## Step 7 — Dashboard

- [ ] `/` — service grid (current status, uptime 24 h / 7 d / 30 d, latency sparkline), 90-day uptime bars (per-day green/yellow/red from rollups), incident log with durations.
- [ ] Maintenance-mode toggle (small admin route guarded by `CRON_SECRET`-style header or Vercel password protection).

## Step 8 — Hardening / nice-to-haves (Phase 3 backlog)

- Frontend `/api/health` route (5-line PR to `sentinel-frontend`).
- Celery worker/beat liveness via verify's health endpoint (doc 02).
- Direct postgres/redis checks in the gateway aggregate.
- Escalation: `@here` mention if an incident passes 30 min.
- Public status page polish at a real domain (e.g. `status.fortiqo.xyz`).
- Meta-monitoring: free UptimeRobot ping on the observ app itself (who watches the watcher).

## Acceptance checklist (Phase 2 done when…)

- [ ] Killing any one backend container produces a correct 🔴 alert in ≤ ~6 min and a 🟢 threaded recovery after restart, with accurate duration.
- [ ] Killing the gateway (or the box) produces ONE 🚨 platform-outage alert, not 6.
- [ ] Daily report arrives at 09:00 with believable uptime numbers matching the incident log.
- [ ] Weekly report arrives Monday with trend + MTTR.
- [ ] Dashboard shows live status + history.
- [ ] No secrets in the repo; `/api/cron/*` rejects unauthenticated calls; aggregate endpoint rejects missing token.

## Estimated effort

| Step | Estimate |
|---|---|
| 0–1 | ½ day (mostly Slack clicking + verifying paths) |
| 2 (gateway) | ½ day incl. deploy |
| 3–4 (engine + alerts) | 1 day |
| 5–6 (deploy + summaries) | ½–1 day |
| 7 (dashboard) | 1 day |
| **Total** | **~3–4 days** |
