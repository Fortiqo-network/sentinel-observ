import { getTrafficBetween, getTrafficBreakdown } from "./repo";
import {
  reportParentMessage,
  reportThreadMessages,
  type StorageSummary,
  type TrafficSummary,
} from "./messages";
import { postReport, postMessage, reportChannel } from "./slack";
import type { PeriodReport } from "./rollup";

/**
 * Posting a period report as a Slack thread.
 *
 * The channel gets one short verdict message; the breakdown lands as replies
 * underneath it. That keeps a quiet day to a single line in the channel while
 * still recording the full detail, and it means a bad day's timeline is
 * attached to the summary rather than scattered as separate posts.
 */

export type PostedReport = {
  posted: boolean;
  threadReplies: number;
  error: string | null;
};

/**
 * A synthetic report with representative data, used by
 * `GET /api/slack/test?report=1` to preview the exact daily thread format
 * without waiting a day or needing history. Mixes a healthy service, a
 * recovered outage and an ongoing one so every branch of the formatting is
 * exercised — that is what makes it a real check of the Block Kit payloads.
 */
export function sampleReport(now: Date): PeriodReport {
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const service = (
    id: string,
    name: string,
    downtimeSecs: number,
    incidents: number,
    currentlyDown = false,
  ) => ({
    serviceId: id,
    name,
    uptimePct: Math.max(0, (1 - downtimeSecs / 86400) * 100),
    downtimeSecs,
    incidents,
    totalChecks: 288,
    failedChecks: Math.round(downtimeSecs / 300),
    avgLatencyMs: 40 + Math.round(downtimeSecs / 60),
    p95LatencyMs: 120 + Math.round(downtimeSecs / 30),
    currentlyDown,
  });

  const incident = (
    id: number,
    serviceId: string,
    startedMinAgo: number,
    durationMin: number | null,
    error: string,
  ) => ({
    id,
    service_id: serviceId,
    started_at: new Date(now.getTime() - startedMinAgo * 60_000),
    ended_at:
      durationMin === null
        ? null
        : new Date(now.getTime() - (startedMinAgo - durationMin) * 60_000),
    error,
    failed_checks: Math.max(1, Math.round((durationMin ?? 45) / 5)),
    slack_ts: null,
    last_remind_at: null,
    is_storm: false,
    alert_pending: false,
    recovery_pending: false,
  });

  const incidents = [
    incident(1, "billing", 380, 23, "connect ECONNREFUSED ×3 attempts — process or host is down"),
    incident(2, "runtime", 95, null, "no response within 8s ×3 — hung or overloaded"),
  ];

  return {
    from,
    to: now,
    windowSecs: 86400,
    services: [
      service("gateway", "Gateway", 0, 0),
      service("frontend", "Frontend", 0, 0),
      service("core-api", "Core API", 0, 0),
      service("verify", "Verify", 0, 0),
      service("billing", "Billing", 23 * 60, 1),
      service("registry", "Registry", 0, 0),
      service("runtime", "Runtime", 95 * 60, 1, true),
    ],
    overallUptimePct: 99.42,
    totalIncidents: incidents.length,
    totalDowntimeSecs: (23 + 95) * 60,
    worst: null,
    incidents,
    mttrSecs: 23 * 60,
    longest: incidents[0],
    ticksActual: 288,
    ticksExpected: 288,
  };
}

/** Gather the traffic figures for a report window, comparing with the window before it. */
export async function collectTraffic(from: Date, to: Date): Promise<TrafficSummary | null> {
  const windowMs = to.getTime() - from.getTime();
  const previousFrom = new Date(from.getTime() - windowMs);
  const days = Math.max(1, Math.round(windowMs / (24 * 60 * 60 * 1000)));

  try {
    const [views, previousViews, topPaths] = await Promise.all([
      getTrafficBetween(from, to),
      getTrafficBetween(previousFrom, from),
      getTrafficBreakdown("path", days, 5),
    ]);
    if (views === 0 && previousViews === 0) return null;
    return { views, previousViews, topPaths };
  } catch {
    // Traffic is a nice-to-have on an uptime report; never fail the report for it.
    return null;
  }
}

/**
 * Post the parent message, then every detail reply into its thread.
 *
 * A failed reply is reported but does not stop the remaining ones: a partial
 * thread is far more useful than none, and the parent already carries the
 * verdict.
 */
export async function postThreadedReport(params: {
  report: PeriodReport;
  traffic: TrafficSummary | null;
  period: "daily" | "weekly";
  deltas?: Map<string, number>;
  previousUptimePct?: number;
  storage?: StorageSummary | null;
}): Promise<PostedReport> {
  const parent = await postReport(
    reportParentMessage({
      report: params.report,
      traffic: params.traffic,
      period: params.period,
      previousUptimePct: params.previousUptimePct,
    }),
  );

  if (!parent.ok) {
    return { posted: false, threadReplies: 0, error: parent.error };
  }

  const replies = reportThreadMessages({
    report: params.report,
    traffic: params.traffic,
    deltas: params.deltas,
    storage: params.storage,
  });

  let delivered = 0;
  const errors: string[] = [];
  for (const reply of replies) {
    const result = await postMessage({
      channel: reportChannel(),
      text: reply.text,
      blocks: reply.blocks,
      threadTs: parent.ts,
    });
    if (result.ok) delivered += 1;
    else errors.push(result.error);
  }

  return {
    posted: true,
    threadReplies: delivered,
    error: errors.length ? errors.join("; ") : null,
  };
}
