# sentinel-observ

Uptime monitoring, Slack alerting, and uptime reporting for the Sentinel platform.

A Next.js app deployed on **Vercel** that:

1. **Checks every Sentinel service every 5 minutes** (health-endpoint probes).
2. **Alerts on Slack in realtime** (`#sentinel-alarms`) the moment a service goes down, with a proper error message (which service, why, since when) — and posts a recovery message when it comes back.
3. **Posts a daily summary** (per-service uptime %, incidents, response times) and a **weekly summary** to Slack.
4. Serves a **status dashboard** (uptime history, incident log) as a web UI.

## Status

**Phase 1 (current): documentation & design — complete.** Development is on hold until the plan is approved; see [docs/06-implementation-plan.md](docs/06-implementation-plan.md) for Phase 2.

What already exists in this repo (beyond docs):

- `scripts/probe.mjs` — working one-shot health checker (validated 7/7 services up on 2026-07-26, and immediately caught a real `sentinel-runtime` crash loop — see [docs/07-operations-notes.md](docs/07-operations-notes.md)).
- A minimal, **Vercel-deployable** Next.js skeleton: live status page at `/`, `GET /api/probe`, and a `CRON_SECRET`-guarded `POST /api/cron/check` stub. `npm run build` passes. No database, no Slack, no history yet — those are Phase 2. Internal services show "n/a" until the gateway aggregate endpoint (Phase 2, step 2) is deployed.

## Documentation

| Doc | Contents |
|---|---|
| [01-architecture.md](docs/01-architecture.md) | System design, why this shape, key constraints (Vercel cannot reach internal services, Vercel cron limits) |
| [02-service-inventory.md](docs/02-service-inventory.md) | Every `sentinel-*` repo: what it is, whether/how it is monitored, exact health endpoints |
| [03-slack-bot-setup.md](docs/03-slack-bot-setup.md) | Super-baby-steps: create the Slack app/bot, the `#sentinel-alarms` channel, tokens, test message |
| [04-monitoring-spec.md](docs/04-monitoring-spec.md) | Probe logic, retry/flap protection, alert state machine, exact Slack message formats (down / recovery / daily / weekly) |
| [05-data-model.md](docs/05-data-model.md) | Postgres schema, uptime math, retention |
| [06-implementation-plan.md](docs/06-implementation-plan.md) | Phase-2 build order, env vars, deployment steps, acceptance checklist |
| [07-operations-notes.md](docs/07-operations-notes.md) | Incident log & ops findings (runtime crash-loop root cause + pending durable fix, env-file topology, fleet baseline) |

## Quick start (works today, before any code)

A standalone probe script that checks all services once and prints a table — run it from the server (it can reach the internal Docker ports):

```bash
node scripts/probe.mjs
```

## Repo layout (after Phase 2)

```
sentinel-observ/
├── app/                  # Next.js App Router: dashboard + API routes
│   ├── api/cron/check/   # 5-min probe endpoint (called by scheduler)
│   ├── api/cron/daily/   # daily summary endpoint
│   ├── api/cron/weekly/  # weekly summary endpoint
│   └── (dashboard)/      # status pages
├── lib/                  # probe engine, slack client, uptime math
├── scripts/probe.mjs     # standalone one-shot checker (no deps)
├── docs/                 # this documentation set
└── vercel.json           # cron config (if on Vercel Pro)
```
