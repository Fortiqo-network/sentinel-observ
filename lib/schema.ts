import { hasDatabase, query } from "./db";

/**
 * Database schema (docs/05-data-model.md).
 *
 * The DDL lives here rather than in a .sql file so it is always bundled into
 * the serverless function and can be applied automatically on the first tick.
 * There is no separate migration step in the deploy checklist, and no risk of
 * code running ahead of the schema. Every statement is idempotent, so
 * {@link ensureSchema} is safe to call on every invocation.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS checks (
  id          BIGSERIAL PRIMARY KEY,
  service_id  TEXT NOT NULL,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok          BOOLEAN NOT NULL,
  http_status INT,
  latency_ms  INT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_checks_service_time ON checks (service_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_checks_time ON checks (checked_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id               BIGSERIAL PRIMARY KEY,
  service_id       TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,
  error            TEXT,
  failed_checks    INT NOT NULL DEFAULT 1,
  slack_ts         TEXT,
  last_remind_at   TIMESTAMPTZ,
  is_storm         BOOLEAN NOT NULL DEFAULT false,
  alert_pending    BOOLEAN NOT NULL DEFAULT false,
  recovery_pending BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_incidents_service ON incidents (service_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_open ON incidents (ended_at) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS service_state (
  service_id     TEXT PRIMARY KEY,
  status         TEXT NOT NULL CHECK (status IN ('up', 'down', 'maintenance')),
  since          TIMESTAMPTZ NOT NULL,
  last_check_at  TIMESTAMPTZ NOT NULL,
  open_incident  BIGINT REFERENCES incidents (id)
);

CREATE TABLE IF NOT EXISTS daily_rollups (
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

-- one row per visit to sentinel-frontend, reported by its edge middleware.
-- Deliberately not de-duplicated: the requirement is raw visit volume, and
-- storing no identifier keeps this well clear of being personal data.
CREATE TABLE IF NOT EXISTS pageviews (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  path          TEXT NOT NULL,
  referrer_host TEXT,
  country       TEXT
);
CREATE INDEX IF NOT EXISTS idx_pageviews_time ON pageviews (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_pageviews_path ON pageviews (path, occurred_at DESC);

-- Per-day visit counts, written before raw pageviews are pruned. Raw rows are
-- the only table that grows with traffic rather than with time, so they are the
-- one real threat to the storage budget; rolling them up first means retention
-- can be tightened aggressively without ever losing the historical counts.
CREATE TABLE IF NOT EXISTS pageview_daily (
  day   DATE NOT NULL,
  path  TEXT NOT NULL,
  views INT NOT NULL,
  PRIMARY KEY (day, path)
);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id             BIGSERIAL PRIMARY KEY,
  ran_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind           TEXT NOT NULL,
  duration_ms    INT NOT NULL,
  services_up    INT NOT NULL,
  services_total INT NOT NULL,
  alerts_sent    INT NOT NULL DEFAULT 0,
  error          TEXT
);
CREATE INDEX IF NOT EXISTS idx_monitor_runs_time ON monitor_runs (ran_at DESC);
`;

let applied = false;

/**
 * Create every table and index if missing. Cached per warm instance so a busy
 * lambda does not re-run the DDL on each request.
 */
export async function ensureSchema(): Promise<void> {
  if (applied || !hasDatabase()) return;
  await query(SCHEMA_SQL);
  applied = true;
}
