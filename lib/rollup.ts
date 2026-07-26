import {
  getDowntime,
  getOpenIncidents,
  getRuns,
  getWindowStats,
  listIncidents,
  writeDailyRollups,
  type IncidentRow,
} from "./repo";
import { SERVICES } from "./services";
import { secondsBetween, uptimePercent } from "./format";

/**
 * Uptime math and period reports (docs/05-data-model.md).
 *
 * Uptime comes from incident spans clipped to the window, never from failed
 * check counts: the scheduler can drift or miss a tick, and counting checks
 * would turn a missing tick into fake downtime.
 */

export type ServiceReportRow = {
  serviceId: string;
  name: string;
  uptimePct: number;
  downtimeSecs: number;
  incidents: number;
  totalChecks: number;
  failedChecks: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  currentlyDown: boolean;
};

export type PeriodReport = {
  from: Date;
  to: Date;
  windowSecs: number;
  services: ServiceReportRow[];
  overallUptimePct: number;
  totalIncidents: number;
  totalDowntimeSecs: number;
  worst: ServiceReportRow | null;
  incidents: IncidentRow[];
  mttrSecs: number | null;
  longest: IncidentRow | null;
  /** Ticks the scheduler actually delivered vs. what a 5-minute cadence implies. */
  ticksActual: number;
  ticksExpected: number;
};

const TICK_INTERVAL_SECS = 300;

/** Build the full uptime/latency/incident picture for one time window. */
export async function buildPeriodReport(from: Date, to: Date): Promise<PeriodReport> {
  const windowSecs = secondsBetween(from, to);
  const [stats, downtime, incidents, openIncidents, runs] = await Promise.all([
    getWindowStats(from, to),
    getDowntime(from, to),
    listIncidents({ since: from, limit: 200 }),
    getOpenIncidents(),
    getRuns(from),
  ]);

  const statsById = new Map(stats.map((s) => [s.service_id, s]));
  const downtimeById = new Map(downtime.map((d) => [d.service_id, d]));
  const openIds = new Set(openIncidents.map((i) => i.service_id));

  const services: ServiceReportRow[] = SERVICES.map((svc) => {
    const stat = statsById.get(svc.id);
    const down = downtimeById.get(svc.id);
    const downtimeSecs = down?.downtime_secs ?? 0;
    return {
      serviceId: svc.id,
      name: svc.name,
      uptimePct: uptimePercent(downtimeSecs, windowSecs),
      downtimeSecs,
      incidents: down?.incident_count ?? 0,
      totalChecks: stat?.total_checks ?? 0,
      failedChecks: stat?.failed_checks ?? 0,
      avgLatencyMs: stat?.avg_latency_ms ?? null,
      p95LatencyMs: stat?.p95_latency_ms ?? null,
      currentlyDown: openIds.has(svc.id),
    };
  });

  const inWindow = incidents.filter((i) => i.started_at < to && (!i.ended_at || i.ended_at > from));
  const resolved = inWindow.filter((i) => i.ended_at !== null);
  const mttrSecs = resolved.length
    ? resolved.reduce((sum, i) => sum + secondsBetween(i.started_at, i.ended_at!), 0) / resolved.length
    : null;

  const longest = resolved.reduce<IncidentRow | null>((best, i) => {
    if (!best) return i;
    return secondsBetween(i.started_at, i.ended_at!) >
      secondsBetween(best.started_at, best.ended_at!)
      ? i
      : best;
  }, null);

  const totalDowntimeSecs = services.reduce((sum, s) => sum + s.downtimeSecs, 0);
  const overallUptimePct = services.length
    ? uptimePercent(totalDowntimeSecs, windowSecs * services.length)
    : 100;

  const worst = services.reduce<ServiceReportRow | null>((acc, s) => {
    if (s.downtimeSecs === 0) return acc;
    if (!acc || s.downtimeSecs > acc.downtimeSecs) return s;
    return acc;
  }, null);

  return {
    from,
    to,
    windowSecs,
    services,
    overallUptimePct,
    totalIncidents: inWindow.length,
    totalDowntimeSecs,
    worst,
    incidents: inWindow,
    mttrSecs,
    longest,
    ticksActual: runs.length,
    ticksExpected: Math.round(windowSecs / TICK_INTERVAL_SECS),
  };
}

/**
 * Persist a completed day's aggregates so long dashboard ranges and weekly
 * reports stay fast once raw checks are pruned.
 */
export async function persistDailyRollups(day: Date): Promise<number> {
  const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const report = await buildPeriodReport(from, to);

  await writeDailyRollups(
    from.toISOString().slice(0, 10),
    report.services.map((s) => ({
      serviceId: s.serviceId,
      totalChecks: s.totalChecks,
      failedChecks: s.failedChecks,
      downtimeSecs: Math.round(s.downtimeSecs),
      incidents: s.incidents,
      avgLatencyMs: s.avgLatencyMs,
      p95LatencyMs: s.p95LatencyMs,
    })),
  );
  return report.services.length;
}

/** Per-service uptime delta between two windows, for the weekly trend column. */
export function uptimeDelta(
  current: PeriodReport,
  previous: PeriodReport,
): Map<string, number> {
  const prev = new Map(previous.services.map((s) => [s.serviceId, s.uptimePct]));
  return new Map(
    current.services.map((s) => [s.serviceId, s.uptimePct - (prev.get(s.serviceId) ?? s.uptimePct)]),
  );
}
