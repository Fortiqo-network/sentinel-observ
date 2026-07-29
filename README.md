# sentinel-observ

Uptime monitoring, Slack alerting, and uptime reporting for the Sentinel platform.

A Next.js app deployed on **Vercel** at **https://monitor.fortiqo.xyz** (its own Vercel project + Cloudflare DNS, the same shape as `docs.fortiqo.xyz`) that:

1. **Checks every Sentinel service every 5 minutes** (health-endpoint probes, 3 attempts before a service counts as down).
2. **Alerts on Slack in realtime** (`#sentinel-alarms`) the moment a service goes down — which service, why, since when, what it breaks for users, and the first command to run — then posts a threaded recovery message with the exact downtime.
3. **Posts a daily and weekly uptime report as a Slack thread** — a one-line verdict in the channel, with the breakdown as replies: per-service uptime, exactly when each service went down and how long it took to come back, MTTR, longest outage, and frontend traffic.
4. Serves a **monitoring dashboard**: live status, 24-hour latency chart, 90-day uptime bars, incident log, per-service drill-down, and the monitor's own liveness.
5. Counts **every visit to sentinel-frontend**, reported server-side from its edge middleware so ad-blockers cannot undercount, and charts it at `/analytics`.
6. Watches the **money path** — metering-stream backlog and stranded settlements — because a platform can be 7/7 green while nobody is being billed and no seller is being paid.

### Why the money path is monitored separately

Liveness probes answer "is the process running?". Two failures pass every one of them:

- **the metering consumer dies** — the gateway keeps writing signed usage events, agents keep executing, calls return 200, and nothing is ever billed;
- **the settlement reaper stalls** — buyer funds stay held and sellers are never paid. The reserve path is fail-closed by design, so this looks healthy right up until someone's balance is wrong.

Billing computes both in `GET /v1/ops/money-health`; the gateway relays it; this app records it, shows it on the dashboard, and alerts **on transition** (never every five minutes). Thresholds derive from billing's own `settlement_ttl_hours` and `settlement_confirm_window_hours`, so retuning the state machine automatically retunes the monitoring.

The dashboard is **private** — password-protected via `middleware.ts` and excluded from every search index. The scheduler, Slack test and pageview-ingest endpoints are exempt from the login wall because they authenticate with their own secrets.

## Status

**Live at https://monitor.fortiqo.xyz.** Full breakdown of what is proven vs merely built, and everything still pending: **[docs/10-status-and-roadmap.md](docs/10-status-and-roadmap.md)**.

The two things that most need attention right now: the GitHub Actions scheduler is delivering roughly 5% of its ticks (so detection latency is hours, not minutes), and the alert path has never fired on a real outage.

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
| [09-secrets-and-vercel.md](docs/09-secrets-and-vercel.md) | **Canonical reference** — every secret and where it lives, which values must match, all Vercel project settings, rotation order |
| [10-status-and-roadmap.md](docs/10-status-and-roadmap.md) | **START HERE** — what works, what is proven, what is pending (operator vs engineering), what is deliberately out of scope, known limitations |
| [11-chatops-deploys.md](docs/11-chatops-deploys.md) | `/deploy` from Slack — Slack app setup, GitHub token scopes, security posture, troubleshooting |

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

Then, in this repo's GitHub settings → Secrets and variables → Actions, add **`CRON_SECRET`** — that is the only required one; the workflow defaults to `https://monitor.fortiqo.xyz`. Optionally add `SLACK_BOT_TOKEN` + `SLACK_ALARM_CHANNEL_ID` so a failed run warns you that the monitor itself is down. [`.github/workflows/monitor-tick.yml`](.github/workflows/monitor-tick.yml) drives all three schedules. Full table: [docs/09](docs/09-secrets-and-vercel.md).

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
| `/` | password | Dashboard: live status, KPIs, service grid, latency chart, 90-day uptime, incidents, monitor health |
| `/services/[id]` | password | Per-service drill-down: uptime, latency, incident history, raw checks, runbook |
| `/incidents` | password | Full incident log with MTTR and the worst outage |
| `/analytics` | password | sentinel-frontend visit counts: hourly, daily, top pages, referrers, countries |
| `GET /api/status` | password | JSON snapshot of the monitoring data |
| `GET /api/probe` | password | One-shot live probe, no persistence |
| `POST /api/ingest/pageview` | `INGEST_TOKEN` | Pageview beacon from sentinel-frontend's edge middleware |
| `POST /api/slack/command` | Slack signature | `/deploy` — posts an ephemeral service picker |
| `POST /api/slack/interactive` | Slack signature + user allowlist | Deploy button clicks; dispatches `deploy.yml` and records the attempt |
| `POST /api/cron/check` | `CRON_SECRET` | The 5-minute tick: probe → persist → alert |
| `POST /api/cron/daily` | `CRON_SECRET` | Daily report + rollups + prune |
| `POST /api/cron/weekly` | `CRON_SECRET` | Weekly report with trend and MTTR |
| `GET /api/slack/test` | `CRON_SECRET` | Post a test message to each configured channel |
| `GET /api/slack/test?report=1` | `CRON_SECRET` | Post a sample uptime-report thread to preview the daily format |

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
