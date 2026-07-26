import { hasDatabase } from "./db";
import { ensureSchema } from "./schema";
import {
  getDailySeries,
  getDowntime,
  getLatencySeries,
  getRuns,
  getServiceStates,
  getWindowStats,
  listIncidents,
  type DailyPoint,
  type IncidentRow,
  type LatencyPoint,
} from "./repo";
import { probeAll, type CheckResult } from "./probe";
import { SERVICES, type ServiceDef } from "./services";
import { secondsBetween, uptimePercent } from "./format";
import { isSlackConfigured } from "./slack";

/**
 * Everything the dashboard renders, assembled in one place so the server
 * components and `/api/status` can never drift apart.
 *
 * The live probe always runs, so the page is useful on a fresh deploy with no
 * database and no history yet; historical panels degrade to an empty state
 * instead of erroring.
 */

export type ServiceCard = {
  service: ServiceDef;
  live: CheckResult | null;
  status: "up" | "down" | "maintenance" | "unknown";
  since: Date | null;
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  maxLatencyMs: number | null;
  checks24h: number;
  failed24h: number;
  incidents30d: number;
  downtime30dSecs: number;
  lastError: string | null;
};

export type MonitorHealth = {
  ticks24h: number;
  ticksExpected: number;
  lastRunAt: Date | null;
  avgDurationMs: number | null;
  alertsSent24h: number;
};

export type DashboardData = {
  generatedAt: Date;
  hasHistory: boolean;
  config: { database: boolean; slack: boolean; aggregate: boolean; scheduler: boolean };
  cards: ServiceCard[];
  overall: {
    up: number;
    total: number;
    unknown: number;
    uptime24h: number | null;
    uptime30d: number | null;
    openIncidents: number;
    incidents30d: number;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    totalChecks24h: number;
  };
  incidents: IncidentRow[];
  latency: LatencyPoint[];
  daily: DailyPoint[];
  monitor: MonitorHealth;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TICK_SECS = 300;
const LATENCY_BUCKET_MINUTES = 15;
const UPTIME_HISTORY_DAYS = 90;

function emptyMonitorHealth(): MonitorHealth {
  return { ticks24h: 0, ticksExpected: 288, lastRunAt: null, avgDurationMs: null, alertsSent24h: 0 };
}

/** Assemble the whole dashboard payload. */
export async function getDashboard(): Promise<DashboardData> {
  const now = new Date();
  const live = await probeAll();
  const liveById = new Map(live.map((r) => [r.id, r]));

  const aggregateConfigured = Boolean(process.env.GATEWAY_URL && process.env.MONITOR_TOKEN);
  const config = {
    database: hasDatabase(),
    slack: isSlackConfigured(),
    aggregate: aggregateConfigured,
    scheduler: Boolean(process.env.CRON_SECRET),
  };

  if (!config.database) {
    return {
      generatedAt: now,
      hasHistory: false,
      config,
      cards: SERVICES.map((service) => liveOnlyCard(service, liveById.get(service.id) ?? null)),
      overall: liveOnlyOverall(live),
      incidents: [],
      latency: [],
      daily: [],
      monitor: emptyMonitorHealth(),
    };
  }

  await ensureSchema();

  const since24h = new Date(now.getTime() - DAY_MS);
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  const since30d = new Date(now.getTime() - 30 * DAY_MS);

  const [states, stats24h, down24h, down7d, down30d, incidents, latency, daily, runs] =
    await Promise.all([
      getServiceStates(),
      getWindowStats(since24h),
      getDowntime(since24h, now),
      getDowntime(since7d, now),
      getDowntime(since30d, now),
      listIncidents({ limit: 25 }),
      getLatencySeries(since24h, LATENCY_BUCKET_MINUTES),
      getDailySeries(UPTIME_HISTORY_DAYS),
      getRuns(since24h),
    ]);

  const statsById = new Map(stats24h.map((s) => [s.service_id, s]));
  const down24hById = new Map(down24h.map((d) => [d.service_id, d]));
  const down7dById = new Map(down7d.map((d) => [d.service_id, d]));
  const down30dById = new Map(down30d.map((d) => [d.service_id, d]));

  const cards: ServiceCard[] = SERVICES.map((service) => {
    const state = states.get(service.id);
    const liveResult = liveById.get(service.id) ?? null;
    const stat = statsById.get(service.id);
    const has24h = (stat?.total_checks ?? 0) > 0;

    return {
      service,
      live: liveResult,
      status: state?.status ?? (liveResult?.unknown ? "unknown" : liveResult?.ok ? "up" : "down"),
      since: state?.since ?? null,
      uptime24h: has24h
        ? uptimePercent(down24hById.get(service.id)?.downtime_secs ?? 0, DAY_MS / 1000)
        : null,
      uptime7d: has24h
        ? uptimePercent(down7dById.get(service.id)?.downtime_secs ?? 0, (7 * DAY_MS) / 1000)
        : null,
      uptime30d: has24h
        ? uptimePercent(down30dById.get(service.id)?.downtime_secs ?? 0, (30 * DAY_MS) / 1000)
        : null,
      avgLatencyMs: stat?.avg_latency_ms ?? null,
      p95LatencyMs: stat?.p95_latency_ms ?? null,
      maxLatencyMs: stat?.max_latency_ms ?? null,
      checks24h: stat?.total_checks ?? 0,
      failed24h: stat?.failed_checks ?? 0,
      incidents30d: down30dById.get(service.id)?.incident_count ?? 0,
      downtime30dSecs: down30dById.get(service.id)?.downtime_secs ?? 0,
      lastError: liveResult?.error ?? null,
    };
  });

  const monitored = cards.filter((c) => c.status !== "unknown");
  const totalDowntime24h = monitored.reduce(
    (sum, c) => sum + (down24hById.get(c.service.id)?.downtime_secs ?? 0),
    0,
  );
  const totalDowntime30d = monitored.reduce(
    (sum, c) => sum + (down30dById.get(c.service.id)?.downtime_secs ?? 0),
    0,
  );
  const latencySamples = cards.map((c) => c.avgLatencyMs).filter((v): v is number => v !== null);
  const p95Samples = cards.map((c) => c.p95LatencyMs).filter((v): v is number => v !== null);

  return {
    generatedAt: now,
    hasHistory: cards.some((c) => c.checks24h > 0),
    config,
    cards,
    overall: {
      up: cards.filter((c) => c.status === "up").length,
      total: cards.length,
      unknown: cards.filter((c) => c.status === "unknown").length,
      uptime24h: monitored.length
        ? uptimePercent(totalDowntime24h, (DAY_MS / 1000) * monitored.length)
        : null,
      uptime30d: monitored.length
        ? uptimePercent(totalDowntime30d, ((30 * DAY_MS) / 1000) * monitored.length)
        : null,
      openIncidents: incidents.filter((i) => i.ended_at === null).length,
      incidents30d: cards.reduce((sum, c) => sum + c.incidents30d, 0),
      avgLatencyMs: latencySamples.length
        ? Math.round(latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length)
        : null,
      p95LatencyMs: p95Samples.length ? Math.max(...p95Samples) : null,
      totalChecks24h: cards.reduce((sum, c) => sum + c.checks24h, 0),
    },
    incidents,
    latency,
    daily,
    monitor: {
      ticks24h: runs.length,
      ticksExpected: Math.round(DAY_MS / 1000 / TICK_SECS),
      lastRunAt: runs[0]?.ran_at ?? null,
      avgDurationMs: runs.length
        ? Math.round(runs.reduce((sum, r) => sum + r.duration_ms, 0) / runs.length)
        : null,
      alertsSent24h: runs.reduce((sum, r) => sum + r.alerts_sent, 0),
    },
  };
}

function liveOnlyCard(service: ServiceDef, live: CheckResult | null): ServiceCard {
  return {
    service,
    live,
    status: live?.unknown ? "unknown" : live?.ok ? "up" : "down",
    since: null,
    uptime24h: null,
    uptime7d: null,
    uptime30d: null,
    avgLatencyMs: live?.latencyMs ?? null,
    p95LatencyMs: null,
    maxLatencyMs: null,
    checks24h: 0,
    failed24h: 0,
    incidents30d: 0,
    downtime30dSecs: 0,
    lastError: live?.error ?? null,
  };
}

function liveOnlyOverall(live: CheckResult[]): DashboardData["overall"] {
  const known = live.filter((r) => !r.unknown);
  const latencies = known.map((r) => r.latencyMs).filter((v): v is number => v !== null);
  return {
    up: known.filter((r) => r.ok).length,
    total: live.length,
    unknown: live.length - known.length,
    uptime24h: null,
    uptime30d: null,
    openIncidents: known.filter((r) => !r.ok).length,
    incidents30d: 0,
    avgLatencyMs: latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null,
    p95LatencyMs: latencies.length ? Math.max(...latencies) : null,
    totalChecks24h: 0,
  };
}

/** Detail-page payload for one service. */
export async function getServiceDetail(serviceId: string) {
  const service = SERVICES.find((s) => s.id === serviceId);
  if (!service) return null;

  const now = new Date();
  const since24h = new Date(now.getTime() - DAY_MS);
  const since30d = new Date(now.getTime() - 30 * DAY_MS);

  if (!hasDatabase()) {
    return {
      service,
      hasHistory: false,
      checks: [],
      incidents: [],
      latency: [],
      daily: [],
      stats: null,
      uptime30d: null,
      state: null,
      now,
    };
  }

  await ensureSchema();
  const { getRecentChecks } = await import("./repo");
  const [checks, incidents, latency, daily, stats, downtime, states] = await Promise.all([
    getRecentChecks(serviceId, 120),
    listIncidents({ serviceId, limit: 40 }),
    getLatencySeries(since24h, LATENCY_BUCKET_MINUTES),
    getDailySeries(UPTIME_HISTORY_DAYS),
    getWindowStats(since24h),
    getDowntime(since30d, now),
    getServiceStates(),
  ]);

  return {
    service,
    hasHistory: checks.length > 0,
    checks,
    incidents,
    latency: latency.filter((p) => p.service_id === serviceId),
    daily: daily.filter((p) => p.service_id === serviceId),
    stats: stats.find((s) => s.service_id === serviceId) ?? null,
    uptime30d: uptimePercent(
      downtime.find((d) => d.service_id === serviceId)?.downtime_secs ?? 0,
      (30 * DAY_MS) / 1000,
    ),
    state: states.get(serviceId) ?? null,
    now,
  };
}

/** Elapsed label for "up for 3 d 4 h" style copy. */
export function elapsedSince(since: Date | null, now: Date): number | null {
  return since ? secondsBetween(since, now) : null;
}
