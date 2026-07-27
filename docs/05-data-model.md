# 05 — Data model

Postgres (Neon free tier via Vercel Marketplace, or any Postgres). The `pg` driver, no ORM — five tables do not need one.

**The schema lives in [`lib/schema.ts`](../lib/schema.ts), not in a `.sql` file.** Every statement is idempotent (`CREATE TABLE IF NOT EXISTS`) and `ensureSchema()` runs on the first tick of a warm instance, so there is no separate migration step in the deploy checklist and code can never run ahead of the schema. Point `DATABASE_URL` at an empty database and the first `/api/cron/check` creates everything.

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

-- one row per outage
CREATE TABLE incidents (
  id               BIGSERIAL PRIMARY KEY,
  service_id       TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,           -- NULL while ongoing
  error            TEXT,                  -- first failure reason
  failed_checks    INT NOT NULL DEFAULT 1,
  slack_ts         TEXT,                  -- ts of the 🔴 message → recovery threads under it
  last_remind_at   TIMESTAMPTZ,           -- for the 30/60-min "still down" reminders
  is_storm         BOOLEAN NOT NULL DEFAULT false,   -- part of a platform-outage batch
  alert_pending    BOOLEAN NOT NULL DEFAULT false,   -- 🔴 not yet accepted by Slack
  recovery_pending BOOLEAN NOT NULL DEFAULT false    -- 🟢 not yet accepted by Slack
);

-- current state per service (what the state machine reads/writes)
CREATE TABLE service_state (
  service_id     TEXT PRIMARY KEY,
  status         TEXT NOT NULL CHECK (status IN ('up','down','maintenance')),
  since          TIMESTAMPTZ NOT NULL,    -- when the current status began
  last_check_at  TIMESTAMPTZ NOT NULL,
  open_incident  BIGINT REFERENCES incidents (id)
);

-- daily per-service aggregates; keeps long ranges fast and lets raw checks be pruned
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

-- one row per cron run, so the monitor can prove it is alive
CREATE TABLE monitor_runs (
  id             BIGSERIAL PRIMARY KEY,
  ran_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind           TEXT NOT NULL,           -- 'check' | 'daily' | 'weekly'
  duration_ms    INT NOT NULL,
  services_up    INT NOT NULL,
  services_total INT NOT NULL,
  alerts_sent    INT NOT NULL DEFAULT 0,
  error          TEXT
);
```

`alert_pending` / `recovery_pending` are the reason a Slack outage cannot lose an alert: an incident's flag is only cleared once Slack has accepted the message, and every tick re-sends what is still flagged (storm incidents are re-sent as one combined message, not a burst).

`monitor_runs` answers "is the monitor itself running?" — a dashboard that shows zero incidents because nothing has been checked looks identical to a healthy platform, which is the failure mode this table exists to prevent.

## Uptime math

- **Uptime % (period)** = `1 − downtime_secs / period_secs`, where downtime comes from **incident spans clipped to the period**, not from failed-check counts. Deriving it from check counts would turn a missed scheduler tick into fake downtime.
- An ongoing incident contributes downtime up to `now` / the period end.
- `maintenance` windows are recorded but never alert.
- Latency stats (avg, p95, max) are computed over successful checks only.

## Retention & the storage budget

The database is a Neon free tier with a hard **500 MB** ceiling, and this app is its only writer. Retention is therefore **measured, not assumed**: the daily job reads `pg_database_size()` and applies the tier matching current usage.

| Usage | Tier | `checks` | raw `pageviews` | `monitor_runs` |
|---|---|---|---|---|
| < 60% | normal | 90 d | 180 d | 180 d |
| 60–80% | reduced | 45 d | 90 d | 90 d |
| 80–92% | tight | 21 d | 45 d | 45 d |
| > 92% | emergency | 7 d | 14 d | 14 d |

**Rollup tables are never pruned.** Before raw rows are deleted they are aggregated — `checks` into `daily_rollups`, `pageviews` into `pageview_daily` — so tightening retention costs *detail*, never *history*. Uptime percentages, incident history and visit totals are identical at every tier. This is verified: rolling rows up and deleting the raw ones leaves every reported total, day series and path ranking byte-identical, and re-running changes nothing.

`VACUUM (ANALYZE)` runs after any prune. Without it, deleted rows leave dead tuples still occupying pages, the space never returns, and the next run would prune harder for no benefit.

| Table | Growth | Notes |
|---|---|---|
| `checks` | ~2k rows/day, fixed | 7 services × 288 ticks; grows with time only |
| `pageviews` | **grows with traffic** | the one unbounded table, and the reason the guard exists |
| `pageview_daily` | ~1 row per path per day | permanent, negligible |
| `incidents` | a few rows per outage | permanent |
| `daily_rollups` | 7 rows/day | permanent |
| `monitor_runs` | ~300 rows/day | the liveness record |

Set `STORAGE_LIMIT_MB` to change the ceiling if the plan changes. Current usage, the active tier and the per-table breakdown are shown on the dashboard and in the daily Slack thread.

The 90-day uptime strip reads raw `checks` where they still exist and falls back to `daily_rollups` for pruned days, so history does not develop holes at the retention boundary. Traffic queries do the same across `pageviews` and `pageview_daily`.

**Window alignment matters here.** Both sides of those unions filter on UTC calendar-day boundaries, not on `now() - INTERVAL`. Mixing the two makes a visit count differently depending on which table it currently lives in, so a rollup silently changes historical totals — a bug this codebase had and now has a test for.

## Environment variables (full list)

| Var | Required for | Purpose |
|---|---|---|
| `CRON_SECRET` | scheduled checks | Bearer auth on `/api/cron/*` and `/api/slack/test`. Also a GitHub Actions secret |
| `DATABASE_URL` | history, uptime %, alerts | Postgres connection string. Unset ⇒ live-probe-only mode |
| `GATEWAY_URL` | internal services | `https://sentinel-api.fortiqo.xyz` |
| `MONITOR_TOKEN` | internal services | Must equal `MONITOR_TOKEN` in the sentinel-gateway deployment |
| `SLACK_BOT_TOKEN` | alerting | `xoxb-…` from doc 03 |
| `SLACK_ALARM_CHANNEL_ID` | alerting | `#sentinel-alarms` channel ID |
| `SLACK_REPORT_CHANNEL_ID` | reports | Optional — falls back to the alarm channel |
| `DASHBOARD_URL` | nicety | Public URL of this app; when set, Slack alerts link back to it |

Also set as **GitHub Actions repository secrets**: `CRON_SECRET` and `OBSERV_URL`.
