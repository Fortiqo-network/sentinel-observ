# sentinel-observ

Uptime monitoring, Slack alerting, and uptime reporting for the Sentinel platform.

A Next.js app deployed on **Vercel** that:

1. **Checks every Sentinel service every 5 minutes** (health-endpoint probes).
2. **Alerts on Slack in realtime** (`#sentinel-alarms`) the moment a service goes down, with a proper error message (which service, why, since when) — and posts a recovery message when it comes back.
3. **Posts a daily summary** (per-service uptime %, incidents, response times) and a **weekly summary** to Slack.
4. Serves a **status dashboard** (uptime history, incident log) as a web UI.

## Status

**Phase 1 (current): documentation & design — complete.**
Phase 2: development. See [docs/06-implementation-plan.md](docs/06-implementation-plan.md).

## Documentation

| Doc | Contents |
|---|---|
| [01-architecture.md](docs/01-architecture.md) | System design, why this shape, key constraints (Vercel cannot reach internal services, Vercel cron limits) |
| [02-service-inventory.md](docs/02-service-inventory.md) | Every `sentinel-*` repo: what it is, whether/how it is monitored, exact health endpoints |
| [03-slack-bot-setup.md](docs/03-slack-bot-setup.md) | Super-baby-steps: create the Slack app/bot, the `#sentinel-alarms` channel, tokens, test message |
| [04-monitoring-spec.md](docs/04-monitoring-spec.md) | Probe logic, retry/flap protection, alert state machine, exact Slack message formats (down / recovery / daily / weekly) |
| [05-data-model.md](docs/05-data-model.md) | Postgres schema, uptime math, retention |
| [06-implementation-plan.md](docs/06-implementation-plan.md) | Phase-2 build order, env vars, deployment steps, acceptance checklist |

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
