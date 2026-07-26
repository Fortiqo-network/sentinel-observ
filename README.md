# sentinel-observ

Uptime monitoring, Slack alerting, and uptime reporting for the Sentinel platform.

A Next.js app deployed on **Vercel** at **https://monitor.fortiqo.xyz** (its own Vercel project + Cloudflare DNS, the same shape as `docs.fortiqo.xyz`) that:

1. **Checks every Sentinel service every 5 minutes** (health-endpoint probes, 3 attempts before a service counts as down).
2. **Alerts on Slack in realtime** (`#sentinel-alarms`) the moment a service goes down — which service, why, since when, what it breaks for users, and the first command to run — then posts a threaded recovery message with the exact downtime.
3. **Posts a daily and a weekly summary** (per-service uptime %, incidents, latency, MTTR, week-over-week trend).
4. Serves a **monitoring dashboard**: live status, 24-hour latency chart, 90-day uptime bars, incident log, per-service drill-down, and the monitor's own liveness.

## Status

**Phase 2 is built.** Probe engine, Postgres persistence, the alert state machine, Slack alerting (down / storm / recovery / reminders), daily + weekly reports, the dashboard, and the gateway aggregate endpoint are all implemented. `npm run build` passes.

What remains is **configuration, not code** — see [Go live](#go-live) below. Until each secret is set the app degrades honestly rather than lying: with no `DATABASE_URL` the dashboard still probes live but records nothing, and with no `MONITOR_TOKEN` the five internal services show as *not monitored* rather than as up.

> The Postgres query layer has not yet been exercised against a live database — the first `/api/cron/check` against a real `DATABASE_URL` is the step that proves it.

## Documentation

| Doc | Contents |
|---|---|
| [01-architecture.md](docs/01-architecture.md) | System design, why this shape, key constraints (Vercel cannot reach internal services, Vercel cron limits) |
| [02-service-inventory.md](docs/02-service-inventory.md) | Every `sentinel-*` repo: what it is, whether/how it is monitored, exact health endpoints |
| [03-slack-bot-setup.md](docs/03-slack-bot-setup.md) | Super-baby-steps: create the Slack app/bot, the channels, tokens, test message |
| [04-monitoring-spec.md](docs/04-monitoring-spec.md) | Probe logic, retry/flap protection, alert state machine, exact Slack message formats |
| [05-data-model.md](docs/05-data-model.md) | Postgres schema, uptime math, retention, full env var list |
| [06-implementation-plan.md](docs/06-implementation-plan.md) | What shipped, and the remaining go-live checklist |
| [07-operations-notes.md](docs/07-operations-notes.md) | Incident log & ops findings |
| [08-deployment.md](docs/08-deployment.md) | **Deployment runbook** — Vercel project, env vars, `monitor.fortiqo.xyz` DNS, GitHub Actions secrets, verification |

## Go live

Full runbook with every click: **[docs/08-deployment.md](docs/08-deployment.md)**. In summary, six things to set — each a value you paste into the Vercel project's **Environment Variables**, then redeploy.

| # | What | Env var(s) | Where it comes from |
|---|---|---|---|
| 1 | Slack bot | `SLACK_BOT_TOKEN`, `SLACK_ALARM_CHANNEL_ID`, `SLACK_REPORT_CHANNEL_ID` | [docs/03](docs/03-slack-bot-setup.md) — 15 clicks, no code |
| 2 | Database | `DATABASE_URL` | Vercel → Storage → Neon (free tier). Tables are created automatically on the first tick |
| 3 | Scheduler secret | `CRON_SECRET` | `openssl rand -hex 32`. Also add it as a GitHub Actions secret |
| 4 | Gateway probe token | `MONITOR_TOKEN` | `openssl rand -hex 32`. The **same value** goes into sentinel-gateway's env |
| 5 | Gateway URL | `GATEWAY_URL` | `https://sentinel-api.fortiqo.xyz` |
| 6 | Dashboard URL | `DASHBOARD_URL` | `https://monitor.fortiqo.xyz`, so Slack alerts link back to it |

Domain: Vercel → Settings → Domains → add `monitor.fortiqo.xyz`, then a Cloudflare `CNAME monitor → cname.vercel-dns.com` with the proxy **off** (grey cloud) so Vercel can issue and renew the certificate.

Then, in this repo's GitHub settings → Secrets and variables → Actions, add `CRON_SECRET` and `OBSERV_URL` (`https://monitor.fortiqo.xyz`). The workflow in [`.github/workflows/monitor-tick.yml`](.github/workflows/monitor-tick.yml) drives all three schedules.

Verify, in order:

```bash
# 1. Slack credentials work and the bot is in the channel
curl -H "Authorization: Bearer $CRON_SECRET" https://monitor.fortiqo.xyz/api/slack/test

# 2. The gateway aggregate endpoint answers
curl -H "X-Monitor-Token: $MONITOR_TOKEN" https://sentinel-api.fortiqo.xyz/internal/monitor/health

# 3. A full tick runs, persists and alerts
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://monitor.fortiqo.xyz/api/cron/check
```

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `/` | public | Dashboard: live status, KPIs, service grid, latency chart, 90-day uptime, incidents, monitor health |
| `/services/[id]` | public | Per-service drill-down: uptime, latency, incident history, raw checks, runbook |
| `/incidents` | public | Full incident log with MTTR and the worst outage |
| `GET /api/status` | public | JSON snapshot of everything above |
| `GET /api/probe` | public | One-shot live probe, no persistence |
| `POST /api/cron/check` | `CRON_SECRET` | The 5-minute tick: probe → persist → alert |
| `POST /api/cron/daily` | `CRON_SECRET` | Daily report + rollups + prune |
| `POST /api/cron/weekly` | `CRON_SECRET` | Weekly report with trend and MTTR |
| `GET /api/slack/test` | `CRON_SECRET` | Post a test message to each configured channel |

## Local development

```bash
npm install
cp .env.example .env.local     # fill in what you have; everything is optional
npm run dev                    # http://localhost:3000
npm run probe                  # zero-dependency one-shot checker, no app needed
```

## Repo layout

```
sentinel-observ/
├── app/
│   ├── page.tsx                  # dashboard overview
│   ├── services/[id]/page.tsx    # per-service detail
│   ├── incidents/page.tsx        # incident log
│   └── api/{status,probe,slack/test,cron/{check,daily,weekly}}
├── components/                   # brand mark, panels, charts, dashboard sections
├── lib/
│   ├── services.ts               # the inventory — single source of truth
│   ├── probe.ts                  # probe engine (retries, error normalization)
│   ├── state.ts                  # pure alert state machine
│   ├── tick.ts                   # probe → persist → decide → alert
│   ├── slack.ts / messages.ts    # transport + Block Kit payloads
│   ├── db.ts / schema.ts / repo.ts   # Postgres access
│   ├── rollup.ts                 # uptime math + period reports
│   ├── dashboard.ts              # everything the UI renders
│   └── design/                   # colour + type tokens mirrored from sentinel-frontend
├── scripts/probe.mjs             # standalone one-shot checker (no deps)
└── .github/workflows/monitor-tick.yml
```
