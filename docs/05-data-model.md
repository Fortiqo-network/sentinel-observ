# 05 — Data model

Postgres (Neon free tier via Vercel Marketplace, or Vercel Postgres). Plain SQL migrations + the `pg`/`@neondatabase/serverless` driver — no ORM needed for 4 tables.

```sql
-- one row per service per probe tick
CREATE TABLE checks (
  id          BIGSERIAL PRIMARY KEY,
  service_id  TEXT NOT NULL,              -- 'gateway', 'billing', ...
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok          BOOLEAN NOT NULL,
  http_status INT,                        -- NULL on conn error/timeout
  latency_ms  INT,                        -- NULL on failure
  error       TEXT                        -- normalized reason, NULL when ok
);
CREATE INDEX idx_checks_service_time ON checks (service_id, checked_at DESC);

-- current state per service (one row each; what the state machine reads/writes)
CREATE TABLE service_state (
  service_id     TEXT PRIMARY KEY,
  status         TEXT NOT NULL CHECK (status IN ('up','down','maintenance')),
  since          TIMESTAMPTZ NOT NULL,    -- when current status began
  last_check_at  TIMESTAMPTZ NOT NULL,
  open_incident  BIGINT                   -- FK -> incidents.id while down
);

-- one row per outage
CREATE TABLE incidents (
  id             BIGSERIAL PRIMARY KEY,
  service_id     TEXT NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ,             -- NULL while ongoing
  error          TEXT,                    -- first failure reason
  failed_checks  INT NOT NULL DEFAULT 1,
  slack_ts       TEXT,                    -- ts of the 🔴 message → thread recovery under it
  last_remind_at TIMESTAMPTZ,             -- for 30/60-min "still down" reminders
  is_storm       BOOLEAN NOT NULL DEFAULT false  -- part of a platform-outage batch
);
CREATE INDEX idx_incidents_service ON incidents (service_id, started_at DESC);

-- daily per-service aggregates, written once/day; keeps summaries and long
-- dashboard ranges fast and lets raw checks be pruned
CREATE TABLE daily_rollups (
  day             DATE NOT NULL,
  service_id      TEXT NOT NULL,
  total_checks    INT NOT NULL,
  failed_checks   INT NOT NULL,
  downtime_secs   INT NOT NULL,
  incidents       INT NOT NULL,
  avg_latency_ms  INT,
  p95_latency_ms  INT,
  PRIMARY KEY (day, service_id)
);
```

## Uptime math

- **Uptime % (period)** = `1 − downtime_secs / period_secs`, where downtime comes from incident spans clipped to the period (not from check counts — immune to scheduler drift/missed ticks).
- An ongoing incident contributes downtime up to `now`/period end.
- `maintenance` windows are excluded from both numerator and denominator and shown separately.
- Latency stats only over successful checks.

## Retention

| Table | Kept | Why |
|---|---|---|
| `checks` | 90 days (pruned in the daily job) | raw drill-down; ~288 rows/day/service × 7 ≈ 2k rows/day — trivial for free tier |
| `incidents` | forever | it's the outage history; tiny |
| `daily_rollups` | forever | powers weekly/monthly/yearly views forever at 7 rows/day |

## Environment variables (full list)

| Var | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Vercel | Neon/Postgres connection string |
| `CRON_SECRET` | Vercel + GitHub repo secret | auth for `/api/cron/*` |
| `SLACK_BOT_TOKEN` | Vercel | `xoxb-…` from doc 03 |
| `SLACK_ALARM_CHANNEL_ID` | Vercel | `#sentinel-alarms` |
| `SLACK_REPORT_CHANNEL_ID` | Vercel | `#sentinel-reports` |
| `GATEWAY_URL` | Vercel | `https://sentinel-api.fortiqo.xyz` |
| `MONITOR_TOKEN` | Vercel + gateway env (server) | auth for the gateway aggregate endpoint |
| `TZ_REPORT` | Vercel | timezone for daily/weekly report boundaries (e.g. `Asia/Kolkata`), default `UTC` |
