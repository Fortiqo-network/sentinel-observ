# 01 — Architecture

## The two constraints that shape everything

### Constraint A: Vercel cannot reach the internal services

Only two Sentinel endpoints are on the public internet:

- `https://sentinel-api.fortiqo.xyz` — **sentinel-gateway** (the only container on the `sentinel-public` network)
- `https://sentinel.fortiqo.xyz` — **sentinel-frontend** (already on Vercel)

core-api (:8000), verify (:8001), billing (:8002), registry (:8003) and runtime (:8004) sit on the internal `sentinel-net` Docker network on the home server. A monitor running on Vercel has no route to them.

**Decision: add one small aggregated health endpoint to the gateway** (the one service that is already public and already sits on `sentinel-net`):

```
GET /internal/monitor/health
Header: X-Monitor-Token: <MONITOR_TOKEN>
```

It fans out (concurrently, 3 s timeout each) to every internal service's existing health endpoint and returns per-service results:

```json
{
  "checked_at": "2026-07-26T10:05:03Z",
  "services": {
    "core-api":  { "ok": true,  "status": 200, "latency_ms": 12 },
    "verify":    { "ok": true,  "status": 200, "latency_ms": 31 },
    "billing":   { "ok": false, "status": null, "latency_ms": null, "error": "connect ECONNREFUSED" },
    "registry":  { "ok": true,  "status": 200, "latency_ms": 9 },
    "runtime":   { "ok": true,  "status": 200, "latency_ms": 7 }
  }
}
```

Why this beats the alternatives:

| Option | Verdict |
|---|---|
| **Gateway aggregate endpoint** (chosen) | ~80 lines in the repo we already own; no new exposure (token-protected, no data returned beyond up/down); internal services stay untouched |
| Cloudflare tunnel per internal service | 5 new public hostnames + tunnel config to maintain; larger attack surface for zero benefit |
| Probe agent on the server pushing results to Vercel | Another daemon to keep alive (PM2), and it silently dies with the server — pull-based probing from outside is exactly what detects a dead server |

Note the failure semantics are still correct: **if the gateway itself is down, the aggregate call fails, and the monitor alerts "gateway unreachable — entire backend stack may be offline."** That is the truthful message, since the gateway down means the platform is down for users anyway.

### Constraint B: Vercel cron cannot run every 5 minutes on the Hobby plan

Vercel Cron on the Hobby plan is limited to jobs that fire **once per day** (and timing is best-effort). Every-5-minutes crons need Vercel Pro.

**Decision: use a GitHub Actions scheduled workflow as the 5-minute trigger** (free, lives in this repo):

```yaml
# .github/workflows/monitor-tick.yml
on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch: {}
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -m 60 -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            https://<observ-domain>.vercel.app/api/cron/check
```

- Daily (`30 3 * * *`) and weekly (`30 3 * * 1`) summary triggers: same pattern, two more schedule entries hitting `/api/cron/daily` and `/api/cron/weekly`. GitHub cron is UTC, so 03:30 UTC is 09:00 IST. (These two *would* fit in Hobby's Vercel Cron allowance; keeping all three in GitHub Actions keeps one mechanism.) The shipped workflow uses `if: github.event.schedule == …` to route each schedule to its own job, plus a `workflow_dispatch` input to run any of the three by hand.
- GitHub schedules can drift a few minutes under load — acceptable for a 5-min health cadence. The uptime math (doc 05) is based on actual check timestamps, not assumed intervals, so drift doesn't corrupt the numbers.
- If the project is ever on Vercel Pro, delete the workflow and move all three schedules into `vercel.json` — endpoints are identical.

## System diagram

```
GitHub Actions (cron */5)                    Slack workspace
        │ POST /api/cron/check                    ▲
        ▼                                         │ chat.postMessage
┌───────────────────────────── Vercel ─────────────────────────────┐
│  sentinel-observ (Next.js)                                       │
│   /api/cron/check   → probe engine → state machine → alerts ─────┼──► #sentinel-alarms
│   /api/cron/daily   → uptime rollup → daily report ──────────────┼──► #sentinel-reports
│   /api/cron/weekly  → uptime rollup → weekly report ─────────────┘
│   /(dashboard)      → status UI (public read-only)
│        │
│        ▼
│   Postgres (Neon / Vercel Postgres) — checks, incidents, rollups
└──────────────────────────────────────────────────────────────────┘
        │ probes (HTTPS, from Vercel/GH runner — i.e. from the internet)
        ▼
  https://sentinel.fortiqo.xyz          (frontend — direct GET /)
  https://sentinel-api.fortiqo.xyz/health          (gateway — direct)
  https://sentinel-api.fortiqo.xyz/internal/monitor/health   (aggregate)
        │ fan-out inside sentinel-net (gateway does this part)
        ▼
  core-api :8000 /v1/health · verify :8001 /api/v1/health
  billing :8002 /v1/health · registry :8003 /v1/health · runtime :8004 /v1/health
```

## Component responsibilities

| Component | Job |
|---|---|
| **Probe engine** (`lib/probe.ts`) | Given the service inventory, run all checks concurrently with timeout + in-run retries; return normalized `CheckResult[]` |
| **State machine** (`lib/state.ts`) | Compare results with each service's last known state in DB; decide `still_up / went_down / still_down / recovered`; open/close incident rows |
| **Slack client** (`lib/slack.ts`) | `chat.postMessage` with Block Kit payloads (formats in doc 04); no SDK needed, one `fetch` call |
| **Rollup** (`lib/rollup.ts`) | Uptime %, incident list, latency stats over a window (day/week) |
| **Tick** (`lib/tick.ts`) | Orchestration: probe → persist → classify → alert → record the run |
| **Dashboard data** (`lib/dashboard.ts`) | One assembler feeding both the pages and `GET /api/status`, so they cannot drift |
| **Dashboard** | Read-only pages over the same tables: `/`, `/services/[id]`, `/incidents` |

## Modifications to existing repos (kept minimal)

| Repo | Change | Size |
|---|---|---|
| `sentinel-gateway` | Add `GET /internal/monitor/health` (token-protected fan-out, bypasses metering/rate-limit like `/readiness` does) | ~80 lines + tests |
| `sentinel-frontend` | Optional: add `app/api/health/route.ts` returning `{ok:true}` so the probe doesn't depend on the homepage rendering | ~5 lines |
| everything else | **untouched** — existing health endpoints are used as-is | 0 |

## Security notes

- `/api/cron/*` routes require `Authorization: Bearer CRON_SECRET` — nobody else can trigger probes/spam.
- Gateway aggregate endpoint requires `X-Monitor-Token` and returns only up/down/latency — no internals leak.
- Slack bot token is a Vercel server-side env var, never exposed to the dashboard client.
- Dashboard is read-only; if it should be private later, add Vercel password protection or basic auth middleware.
