import { query, queryOne, transaction } from "./db";
import type { CheckResult } from "./probe";

/**
 * Every database read and write used by the tick handler, the reports and the
 * dashboard. Route handlers and pages never write SQL directly.
 *
 * Aggregate counts are cast to `int` in SQL because node-postgres returns
 * `bigint`/`count(*)` as strings, which would silently break arithmetic.
 */

export type ServiceStatus = "up" | "down" | "maintenance";

export type ServiceStateRow = {
  service_id: string;
  status: ServiceStatus;
  since: Date;
  last_check_at: Date;
  open_incident: number | null;
};

export type IncidentRow = {
  id: number;
  service_id: string;
  started_at: Date;
  ended_at: Date | null;
  error: string | null;
  failed_checks: number;
  slack_ts: string | null;
  last_remind_at: Date | null;
  is_storm: boolean;
  alert_pending: boolean;
  recovery_pending: boolean;
};

export type CheckRow = {
  service_id: string;
  checked_at: Date;
  ok: boolean;
  http_status: number | null;
  latency_ms: number | null;
  error: string | null;
};

export type MonitorRunRow = {
  ran_at: Date;
  kind: string;
  duration_ms: number;
  services_up: number;
  services_total: number;
  alerts_sent: number;
  error: string | null;
};

const INCIDENT_COLUMNS = `
  id::int AS id, service_id, started_at, ended_at, error,
  failed_checks, slack_ts, last_remind_at, is_storm,
  alert_pending, recovery_pending
`;

// ── Writes ────────────────────────────────────────────────────────────────────

/** Persist one row per service for a probe tick. */
export async function recordChecks(results: CheckResult[], checkedAt: Date): Promise<void> {
  if (results.length === 0) return;

  const values: unknown[] = [];
  const tuples = results.map((r, i) => {
    const base = i * 6;
    values.push(r.id, checkedAt, r.ok, r.status, r.latencyMs, r.error);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
  });

  await query(
    `INSERT INTO checks (service_id, checked_at, ok, http_status, latency_ms, error)
     VALUES ${tuples.join(", ")}`,
    values,
  );
}

/** Current state of every service, keyed by service id. */
export async function getServiceStates(): Promise<Map<string, ServiceStateRow>> {
  const rows = await query<ServiceStateRow>(
    `SELECT service_id, status, since, last_check_at, open_incident::int AS open_incident
     FROM service_state`,
  );
  return new Map(rows.map((r) => [r.service_id, r]));
}

/**
 * Open an incident and point the service's state row at it, atomically.
 *
 * Returns the new incident id. `alertPending` starts true and is cleared once
 * Slack has accepted the message, so a Slack outage never loses an alert.
 */
export async function openIncident(params: {
  serviceId: string;
  startedAt: Date;
  error: string | null;
  isStorm: boolean;
}): Promise<number> {
  return transaction(async (run) => {
    const [incident] = await run<{ id: number }>(
      `INSERT INTO incidents (service_id, started_at, error, failed_checks, is_storm, alert_pending)
       VALUES ($1, $2, $3, 1, $4, true)
       RETURNING id::int AS id`,
      [params.serviceId, params.startedAt, params.error, params.isStorm],
    );
    await run(
      `INSERT INTO service_state (service_id, status, since, last_check_at, open_incident)
       VALUES ($1, 'down', $2, $2, $3)
       ON CONFLICT (service_id) DO UPDATE
         SET status = 'down', since = $2, last_check_at = $2, open_incident = $3`,
      [params.serviceId, params.startedAt, incident.id],
    );
    return incident.id;
  });
}

/** Close an incident and mark the service up, atomically. */
export async function closeIncident(params: {
  incidentId: number;
  serviceId: string;
  endedAt: Date;
}): Promise<void> {
  await transaction(async (run) => {
    await run(
      `UPDATE incidents SET ended_at = $2, recovery_pending = true WHERE id = $1 AND ended_at IS NULL`,
      [params.incidentId, params.endedAt],
    );
    await run(
      `UPDATE service_state
         SET status = 'up', since = $2, last_check_at = $2, open_incident = NULL
       WHERE service_id = $1`,
      [params.serviceId, params.endedAt],
    );
  });
}

/** Record that a service is still healthy on this tick. */
export async function touchUpState(serviceId: string, checkedAt: Date): Promise<void> {
  await query(
    `INSERT INTO service_state (service_id, status, since, last_check_at, open_incident)
     VALUES ($1, 'up', $2, $2, NULL)
     ON CONFLICT (service_id) DO UPDATE SET last_check_at = $2`,
    [serviceId, checkedAt],
  );
}

/** Bump the failure counter on an open incident and record the latest check time. */
export async function touchDownIncident(params: {
  incidentId: number;
  serviceId: string;
  checkedAt: Date;
}): Promise<void> {
  await transaction(async (run) => {
    await run(`UPDATE incidents SET failed_checks = failed_checks + 1 WHERE id = $1`, [
      params.incidentId,
    ]);
    await run(`UPDATE service_state SET last_check_at = $2 WHERE service_id = $1`, [
      params.serviceId,
      params.checkedAt,
    ]);
  });
}

/** Store the Slack message timestamp so recoveries thread under the alarm. */
export async function setIncidentSlackTs(incidentId: number, ts: string | null): Promise<void> {
  await query(`UPDATE incidents SET slack_ts = $2, alert_pending = false WHERE id = $1`, [
    incidentId,
    ts,
  ]);
}

/** Mark a recovery message as delivered. */
export async function clearRecoveryPending(incidentId: number): Promise<void> {
  await query(`UPDATE incidents SET recovery_pending = false WHERE id = $1`, [incidentId]);
}

/** Record that a "still down" reminder was sent. */
export async function setReminderSent(incidentId: number, at: Date): Promise<void> {
  await query(`UPDATE incidents SET last_remind_at = $2 WHERE id = $1`, [incidentId, at]);
}

/** Log a completed cron run so the dashboard can prove the monitor is alive. */
export async function recordRun(params: {
  kind: string;
  durationMs: number;
  servicesUp: number;
  servicesTotal: number;
  alertsSent: number;
  error?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO monitor_runs (kind, duration_ms, services_up, services_total, alerts_sent, error)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.kind,
      params.durationMs,
      params.servicesUp,
      params.servicesTotal,
      params.alertsSent,
      params.error ?? null,
    ],
  );
}

// ── Incident reads ────────────────────────────────────────────────────────────

/** Incidents whose alert or recovery message has not reached Slack yet. */
export async function getPendingAlertIncidents(): Promise<IncidentRow[]> {
  return query<IncidentRow>(
    `SELECT ${INCIDENT_COLUMNS} FROM incidents
     WHERE alert_pending = true OR recovery_pending = true
     ORDER BY started_at ASC
     LIMIT 25`,
  );
}

/** Every currently-open incident. */
export async function getOpenIncidents(): Promise<IncidentRow[]> {
  return query<IncidentRow>(
    `SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE ended_at IS NULL ORDER BY started_at ASC`,
  );
}

export async function getIncident(id: number): Promise<IncidentRow | null> {
  return queryOne<IncidentRow>(`SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE id = $1`, [id]);
}

/** Most recent incidents, newest first, optionally filtered to one service. */
export async function listIncidents(params: {
  limit?: number;
  serviceId?: string;
  since?: Date;
}): Promise<IncidentRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (params.serviceId) {
    values.push(params.serviceId);
    conditions.push(`service_id = $${values.length}`);
  }
  if (params.since) {
    values.push(params.since);
    conditions.push(`(ended_at IS NULL OR ended_at >= $${values.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  values.push(params.limit ?? 50);
  return query<IncidentRow>(
    `SELECT ${INCIDENT_COLUMNS} FROM incidents ${where}
     ORDER BY started_at DESC LIMIT $${values.length}`,
    values,
  );
}

// ── Analytics reads ───────────────────────────────────────────────────────────

export type ServiceWindowStats = {
  service_id: string;
  total_checks: number;
  failed_checks: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  max_latency_ms: number | null;
};

/** Check counts and latency percentiles per service over a window. */
export async function getWindowStats(since: Date, until?: Date): Promise<ServiceWindowStats[]> {
  return query<ServiceWindowStats>(
    `SELECT service_id,
            COUNT(*)::int AS total_checks,
            (COUNT(*) FILTER (WHERE NOT ok))::int AS failed_checks,
            ROUND(AVG(latency_ms) FILTER (WHERE ok))::int AS avg_latency_ms,
            ROUND((PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)
                   FILTER (WHERE ok))::numeric)::int AS p95_latency_ms,
            (MAX(latency_ms) FILTER (WHERE ok))::int AS max_latency_ms
     FROM checks
     WHERE checked_at >= $1::timestamptz
       AND ($2::timestamptz IS NULL OR checked_at < $2::timestamptz)
     GROUP BY service_id`,
    [since, until ?? null],
  );
}

export type DowntimeRow = { service_id: string; downtime_secs: number; incident_count: number };

/**
 * Downtime per service inside a window, computed from incident spans clipped to
 * the window. Deriving downtime from spans rather than failed-check counts keeps
 * uptime honest when the scheduler drifts or misses a tick.
 */
export async function getDowntime(since: Date, until: Date): Promise<DowntimeRow[]> {
  return query<DowntimeRow>(
    `SELECT service_id,
            COALESCE(SUM(EXTRACT(EPOCH FROM (
              LEAST(COALESCE(ended_at, $2::timestamptz), $2::timestamptz)
              - GREATEST(started_at, $1::timestamptz)
            ))), 0)::int AS downtime_secs,
            COUNT(*)::int AS incident_count
     FROM incidents
     WHERE started_at < $2::timestamptz AND COALESCE(ended_at, $2::timestamptz) > $1::timestamptz
     GROUP BY service_id`,
    [since, until],
  );
}

export type LatencyPoint = { service_id: string; bucket: Date; avg_latency_ms: number | null; failed: number };

/**
 * Latency averaged into fixed-width buckets, for the dashboard's charts.
 * `bucketMinutes` controls resolution (15 min over 24 h → 96 points/service).
 */
export async function getLatencySeries(since: Date, bucketMinutes: number): Promise<LatencyPoint[]> {
  return query<LatencyPoint>(
    `SELECT service_id,
            to_timestamp(
              FLOOR(EXTRACT(EPOCH FROM checked_at) / ($2::int * 60)) * ($2::int * 60)
            ) AS bucket,
            ROUND(AVG(latency_ms) FILTER (WHERE ok))::int AS avg_latency_ms,
            (COUNT(*) FILTER (WHERE NOT ok))::int AS failed
     FROM checks
     WHERE checked_at >= $1::timestamptz
     GROUP BY service_id, bucket
     ORDER BY bucket ASC`,
    [since, bucketMinutes],
  );
}

export type DailyPoint = {
  service_id: string;
  day: string;
  total_checks: number;
  failed_checks: number;
  downtime_secs: number;
};

/**
 * Per-service per-day check outcomes for the uptime bar strip.
 *
 * Raw `checks` are authoritative while they exist; `daily_rollups` fills in any
 * day the retention window has already pruned. Days are bucketed in UTC to
 * match how the UI lays out its 90 columns, regardless of the server timezone.
 */
export async function getDailySeries(days: number): Promise<DailyPoint[]> {
  return query<DailyPoint>(
    `WITH raw AS (
       SELECT service_id,
              to_char(checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS total_checks,
              (COUNT(*) FILTER (WHERE NOT ok))::int AS failed_checks,
              0 AS downtime_secs
       FROM checks
       WHERE checked_at >= now() - ($1::int * INTERVAL '1 day')
       GROUP BY 1, 2
     ), rolled AS (
       SELECT service_id, to_char(day, 'YYYY-MM-DD') AS day,
              total_checks, failed_checks, downtime_secs
       FROM daily_rollups
       WHERE day >= (CURRENT_DATE - ($1::int - 1))
     )
     SELECT * FROM raw
     UNION ALL
     SELECT rolled.* FROM rolled
     WHERE NOT EXISTS (
       SELECT 1 FROM raw
       WHERE raw.service_id = rolled.service_id AND raw.day = rolled.day
     )
     ORDER BY day ASC`,
    [days],
  );
}

/** Raw recent checks for one service (detail page timeline). */
export async function getRecentChecks(serviceId: string, limit: number): Promise<CheckRow[]> {
  return query<CheckRow>(
    `SELECT service_id, checked_at, ok, http_status, latency_ms, error
     FROM checks WHERE service_id = $1
     ORDER BY checked_at DESC LIMIT $2`,
    [serviceId, limit],
  );
}

/**
 * When a job of this kind last completed, or null if it never has.
 *
 * Used to decide whether a periodic report is overdue. Reports are driven by
 * "has it been done recently?" rather than "did the scheduler fire at 03:30?",
 * because external schedulers drop and delay runs and a missed minute must not
 * cost a whole day's report.
 */
export async function getLastRunAt(kind: string): Promise<Date | null> {
  const row = await queryOne<{ ran_at: Date }>(
    `SELECT ran_at FROM monitor_runs WHERE kind = $1 ORDER BY ran_at DESC LIMIT 1`,
    [kind],
  );
  return row?.ran_at ?? null;
}

/**
 * Atomically claim a report period. Returns true only for the caller that won.
 *
 * This is what makes report production exactly-once per period. A read-then-act
 * check ("has a daily run happened since 03:30?") has a gap between the read and
 * the write, and any second caller inside that gap produces a duplicate — which
 * is precisely what a late scheduled call racing the health tick did.
 */
export async function claimReportPeriod(kind: string, periodKey: string): Promise<boolean> {
  const rows = await query<{ kind: string }>(
    `INSERT INTO report_claims (kind, period_key) VALUES ($1, $2)
     ON CONFLICT (kind, period_key) DO NOTHING
     RETURNING kind`,
    [kind, periodKey],
  );
  return rows.length > 0;
}

/** Release a claim so the period can be retried after a failure. */
export async function releaseReportPeriod(kind: string, periodKey: string): Promise<void> {
  await query(`DELETE FROM report_claims WHERE kind = $1 AND period_key = $2`, [kind, periodKey]);
}

/** Cron runs in a window, used for the monitor's own liveness panel. */
export async function getRuns(since: Date, kind = "check"): Promise<MonitorRunRow[]> {
  return query<MonitorRunRow>(
    `SELECT ran_at, kind, duration_ms, services_up, services_total, alerts_sent, error
     FROM monitor_runs
     WHERE ran_at >= $1 AND kind = $2
     ORDER BY ran_at DESC`,
    [since, kind],
  );
}

// ── Traffic (sentinel-frontend pageviews) ─────────────────────────────────────

/** Record one visit. Called by the ingest endpoint, one row per request. */
export async function recordPageview(params: {
  path: string;
  referrerHost: string | null;
  country: string | null;
  occurredAt?: Date;
}): Promise<void> {
  await query(
    `INSERT INTO pageviews (occurred_at, path, referrer_host, country)
     VALUES (COALESCE($1::timestamptz, now()), $2, $3, $4)`,
    [params.occurredAt ?? null, params.path.slice(0, 512), params.referrerHost, params.country],
  );
}

export type TrafficTotals = {
  last_hour: number;
  last_24h: number;
  last_7d: number;
  last_30d: number;
  all_time: number;
};

/**
 * Visit counts over the standard windows.
 *
 * Raw rows and the `pageview_daily` rollup are summed together. They never
 * overlap — a day only reaches the rollup once its raw rows have been deleted —
 * so tightening raw retention under storage pressure loses detail but never
 * changes these totals.
 */
export async function getTrafficTotals(): Promise<TrafficTotals> {
  const rows = await query<TrafficTotals>(
    `WITH bounds AS (
       SELECT ((CURRENT_DATE - 6)::timestamp AT TIME ZONE 'UTC')  AS d7_at,
              ((CURRENT_DATE - 29)::timestamp AT TIME ZONE 'UTC') AS d30_at,
              (CURRENT_DATE - 6)  AS d7_day,
              (CURRENT_DATE - 29) AS d30_day
     ), raw AS (
       SELECT COUNT(*) FILTER (WHERE occurred_at >= now() - INTERVAL '1 hour')   AS h1,
              COUNT(*) FILTER (WHERE occurred_at >= now() - INTERVAL '24 hours') AS d1,
              COUNT(*) FILTER (WHERE occurred_at >= bounds.d7_at)                AS d7,
              COUNT(*) FILTER (WHERE occurred_at >= bounds.d30_at)               AS d30,
              COUNT(*) AS total
       FROM pageviews, bounds
     ), rolled AS (
       SELECT COALESCE(SUM(views) FILTER (WHERE day >= bounds.d7_day), 0)  AS d7,
              COALESCE(SUM(views) FILTER (WHERE day >= bounds.d30_day), 0) AS d30,
              COALESCE(SUM(views), 0) AS total
       FROM pageview_daily, bounds
     )
     SELECT raw.h1::int AS last_hour,
            raw.d1::int AS last_24h,
            (raw.d7 + rolled.d7)::int AS last_7d,
            (raw.d30 + rolled.d30)::int AS last_30d,
            (raw.total + rolled.total)::int AS all_time
     FROM raw, rolled`,
  );
  return rows[0] ?? { last_hour: 0, last_24h: 0, last_7d: 0, last_30d: 0, all_time: 0 };
}

/** Visits inside an explicit window, for period-over-period report comparisons. */
export async function getTrafficBetween(from: Date, to: Date): Promise<number> {
  const rows = await query<{ views: number }>(
    `SELECT COUNT(*)::int AS views FROM pageviews
     WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz`,
    [from, to],
  );
  return rows[0]?.views ?? 0;
}

export type TrafficBucket = { bucket: Date; views: number };

/** Visits per hour over the last 24 h, for the traffic chart. */
export async function getTrafficByHour(): Promise<TrafficBucket[]> {
  return query<TrafficBucket>(
    `SELECT date_trunc('hour', occurred_at) AS bucket, COUNT(*)::int AS views
     FROM pageviews
     WHERE occurred_at >= now() - INTERVAL '24 hours'
     GROUP BY 1 ORDER BY 1 ASC`,
  );
}

export type TrafficDay = { day: string; views: number };

/** Visits per UTC day over a window, combining raw rows with the rollup. */
export async function getTrafficByDay(days: number): Promise<TrafficDay[]> {
  return query<TrafficDay>(
    `WITH bounds AS (
       SELECT (CURRENT_DATE - ($1::int - 1)) AS from_day,
              ((CURRENT_DATE - ($1::int - 1))::timestamp AT TIME ZONE 'UTC') AS from_at
     ), combined AS (
       SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, 1 AS views
       FROM pageviews, bounds
       WHERE occurred_at >= bounds.from_at
       UNION ALL
       SELECT to_char(day, 'YYYY-MM-DD') AS day, views
       FROM pageview_daily, bounds
       WHERE day >= bounds.from_day
     )
     SELECT day, SUM(views)::int AS views FROM combined GROUP BY day ORDER BY day ASC`,
    [days],
  );
}

export type TrafficBreakdown = { label: string; views: number };

/**
 * Top values of one dimension over a window.
 *
 * Paths also read the rollup, so the ranking stays complete after raw rows are
 * pruned. Referrer and country are only rolled up implicitly (not at all), so
 * those two are limited to whatever raw retention the current storage tier
 * allows — a deliberate trade: keeping three dimensions in the rollup would
 * multiply its row count for far less analytical value.
 */
export async function getTrafficBreakdown(
  dimension: "path" | "referrer_host" | "country",
  days: number,
  limit = 10,
): Promise<TrafficBreakdown[]> {
  if (dimension === "path") {
    return query<TrafficBreakdown>(
      `WITH bounds AS (
         SELECT (CURRENT_DATE - ($1::int - 1)) AS from_day,
                ((CURRENT_DATE - ($1::int - 1))::timestamp AT TIME ZONE 'UTC') AS from_at
       ), combined AS (
         SELECT COALESCE(path, 'unknown') AS label, 1 AS views
         FROM pageviews, bounds WHERE occurred_at >= bounds.from_at
         UNION ALL
         SELECT COALESCE(path, 'unknown') AS label, views
         FROM pageview_daily, bounds WHERE day >= bounds.from_day
       )
       SELECT label, SUM(views)::int AS views FROM combined
       GROUP BY label ORDER BY views DESC LIMIT $2`,
      [days, limit],
    );
  }

  const column = dimension === "referrer_host" ? "referrer_host" : "country";
  return query<TrafficBreakdown>(
    `SELECT COALESCE(${column}, 'unknown') AS label, COUNT(*)::int AS views
     FROM pageviews
     WHERE occurred_at >= now() - ($1::int * INTERVAL '1 day')
     GROUP BY 1 ORDER BY views DESC LIMIT $2`,
    [days, limit],
  );
}

// ── Rollup maintenance (daily job) ────────────────────────────────────────────

/** Write (or refresh) the per-service aggregate row for a completed day. */
export async function writeDailyRollups(
  day: string,
  rows: Array<{
    serviceId: string;
    totalChecks: number;
    failedChecks: number;
    downtimeSecs: number;
    incidents: number;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
  }>,
): Promise<void> {
  for (const row of rows) {
    await query(
      `INSERT INTO daily_rollups
         (day, service_id, total_checks, failed_checks, downtime_secs, incidents, avg_latency_ms, p95_latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (day, service_id) DO UPDATE SET
         total_checks = EXCLUDED.total_checks,
         failed_checks = EXCLUDED.failed_checks,
         downtime_secs = EXCLUDED.downtime_secs,
         incidents = EXCLUDED.incidents,
         avg_latency_ms = EXCLUDED.avg_latency_ms,
         p95_latency_ms = EXCLUDED.p95_latency_ms`,
      [
        day,
        row.serviceId,
        row.totalChecks,
        row.failedChecks,
        row.downtimeSecs,
        row.incidents,
        row.avgLatencyMs,
        row.p95LatencyMs,
      ],
    );
  }
}

