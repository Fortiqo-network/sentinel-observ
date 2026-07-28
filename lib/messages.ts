import type { SlackBlock } from "./slack";
import type { CheckResult } from "./probe";
import type { IncidentRow } from "./repo";
import type { PeriodReport, ServiceReportRow } from "./rollup";
import { getService, serviceName, type ServiceDef } from "./services";
import {
  formatDuration,
  formatLatency,
  formatPercent,
  formatUtc,
  formatUtcTime,
  healthEmoji,
  pad,
  padStart,
  secondsBetween,
} from "./format";

/**
 * Slack Block Kit payloads (docs/04-monitoring-spec.md).
 *
 * Each builder returns `{ text, blocks }`: `text` is the push-notification
 * fallback and must stand alone on a phone lock screen; `blocks` carry the
 * formatted body. Per-service impact and debug strings come from the inventory
 * in lib/services.ts, which is what makes an alert actionable.
 */

export type SlackPayload = { text: string; blocks: SlackBlock[] };

function header(text: string): SlackBlock {
  return { type: "header", text: { type: "plain_text", text, emoji: true } };
}

function fields(pairs: Array<[string, string]>): SlackBlock {
  return {
    type: "section",
    fields: pairs.map(([label, value]) => ({ type: "mrkdwn", text: `*${label}*\n${value}` })),
  };
}

function context(text: string): SlackBlock {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

function section(text: string): SlackBlock {
  return { type: "section", text: { type: "mrkdwn", text } };
}

function dashboardLink(): string | null {
  const url = process.env.DASHBOARD_URL;
  return url ? `<${url}|Open the status dashboard>` : null;
}

function locationLabel(svc: ServiceDef): string {
  return svc.host === "vercel"
    ? `sentinel-${svc.id} (Vercel)`
    : `sentinel-${svc.id} (internal :${svc.port})`;
}

// ── Realtime alerts ───────────────────────────────────────────────────────────

/** 🔴 A single service just went down. */
export function downMessage(params: {
  service: ServiceDef;
  result: CheckResult;
  startedAt: Date;
  lastSeenUp: Date | null;
}): SlackPayload {
  const { service, result, startedAt, lastSeenUp } = params;
  const reason = result.error ?? "unknown failure";

  const blocks: SlackBlock[] = [
    header(`🔴 ${service.name} is DOWN`),
    fields([
      ["Service", locationLabel(service)],
      ["Since", formatUtc(startedAt)],
      ["Reason", `\`${reason}\``],
      ["Last seen up", lastSeenUp ? formatUtc(lastSeenUp) : "no prior successful check"],
    ]),
    context(`*Impact:* ${service.impact}`),
    context(`*Check:* \`${service.debug}\``),
  ];

  const link = dashboardLink();
  if (link) blocks.push(context(link));

  return {
    text: `🔴 ${service.name} is DOWN — ${reason} (since ${formatUtcTime(startedAt)})`,
    blocks,
  };
}

/**
 * 🚨 One alert for a correlated outage.
 *
 * The backends share a single machine, so a dead box or tunnel takes every
 * service down at once. Sending six alerts for one root cause trains people to
 * ignore the channel, so the batch collapses into this message instead.
 */
export function stormMessage(params: {
  downServices: string[];
  upServices: string[];
  startedAt: Date;
  reason: string;
}): SlackPayload {
  const names = params.downServices.map(serviceName).join(", ");
  const stillUp = params.upServices.map(serviceName);

  const blocks: SlackBlock[] = [
    header(`🚨 PLATFORM OUTAGE — ${params.downServices.length} services unreachable`),
    section(`*${names}* are all down since *${formatUtc(params.startedAt)}*.`),
    fields([
      ["Reason", `\`${params.reason}\``],
      ["Still up", stillUp.length ? stillUp.join(", ") : "nothing"],
    ]),
    context(
      "This pattern means the runner box, Docker, or the Cloudflare tunnel is down — not an application bug.",
    ),
    context(
      "*Check first:* is the server on · `cloudflared` tunnel up · `docker compose -f docker-compose.prod.yml ps`",
    ),
  ];

  const link = dashboardLink();
  if (link) blocks.push(context(link));

  return {
    text: `🚨 PLATFORM OUTAGE — ${params.downServices.length} services unreachable since ${formatUtcTime(params.startedAt)}`,
    blocks,
  };
}

/** 🟢 Recovery, threaded under the original alarm. */
export function recoveryMessage(params: {
  service: ServiceDef;
  incident: IncidentRow;
  result: CheckResult;
  endedAt: Date;
}): SlackPayload {
  const { service, incident, result, endedAt } = params;
  const downtime = formatDuration(secondsBetween(incident.started_at, endedAt));
  const now = result.status
    ? `HTTP ${result.status} in ${formatLatency(result.latencyMs)}`
    : "healthy";

  return {
    text: `🟢 ${service.name} RECOVERED after ${downtime}`,
    blocks: [
      header(`🟢 ${service.name} RECOVERED`),
      fields([
        [
          "Downtime",
          `${downtime} (${formatUtcTime(incident.started_at)} → ${formatUtcTime(endedAt)})`,
        ],
        ["Checks failed", String(incident.failed_checks)],
        ["Now", now],
        ["Root cause", `\`${incident.error ?? "unknown"}\``],
      ]),
    ],
  };
}

/** ⏰ "Still down" nudge, threaded under the original alarm. */
export function reminderMessage(params: {
  service: ServiceDef;
  incident: IncidentRow;
  now: Date;
}): SlackPayload {
  const elapsed = formatDuration(secondsBetween(params.incident.started_at, params.now));
  return {
    text: `⏰ ${params.service.name} is still DOWN — ${elapsed} and counting`,
    blocks: [
      section(
        `⏰ *${params.service.name} is still DOWN* — ${elapsed} and counting (${params.incident.failed_checks} failed checks).`,
      ),
      context(`Last reason: \`${params.incident.error ?? "unknown"}\` · ${params.service.impact}`),
    ],
  };
}

// ── Periodic reports ──────────────────────────────────────────────────────────

const NAME_W = 10;
const PCT_W = 8;
const INC_W = 4;
const DOWN_W = 9;

function reportTableLines(
  rows: ServiceReportRow[],
  deltas?: Map<string, number>,
): string[] {
  const heading =
    `${pad("SERVICE", NAME_W)} ${padStart("UPTIME", PCT_W)} ${padStart("INC", INC_W)} ` +
    `${padStart("DOWNTIME", DOWN_W)}  AVG / P95`;

  const lines = rows.map((row) => {
    const emoji = healthEmoji(row.uptimePct, row.currentlyDown);
    const delta = deltas?.get(row.serviceId);
    const trend =
      delta === undefined || Math.abs(delta) < 0.005
        ? ""
        : delta > 0
          ? `  ▲${delta.toFixed(2)}`
          : `  ▼${Math.abs(delta).toFixed(2)}`;
    return (
      `${emoji} ${pad(row.name, NAME_W)} ${padStart(formatPercent(row.uptimePct), PCT_W)} ` +
      `${padStart(String(row.incidents), INC_W)} ` +
      `${padStart(row.downtimeSecs ? formatDuration(row.downtimeSecs) : "—", DOWN_W)}  ` +
      `${formatLatency(row.avgLatencyMs)} / ${formatLatency(row.p95LatencyMs)}${trend}`
    );
  });

  return [heading, ...lines];
}

function missedTicksNote(report: PeriodReport): string | null {
  if (report.ticksExpected === 0) return null;
  const missed = report.ticksExpected - report.ticksActual;
  if (missed < Math.max(5, report.ticksExpected * 0.05)) return null;
  return `⚠️ The monitor itself missed ~${missed} of ${report.ticksExpected} scheduled ticks — check the GitHub Actions schedule.`;
}

/** Traffic figures folded into the daily/weekly report thread. */
export type TrafficSummary = {
  views: number;
  previousViews: number;
  topPaths: Array<{ label: string; views: number }>;
};

/** Storage headroom, reported so the free-tier ceiling is never a surprise. */
export type StorageSummary = {
  usedBytes: number;
  limitBytes: number;
  usedPct: number;
  tier: string;
};

/**
 * The parent message of the report thread — deliberately short.
 *
 * This is what appears in the channel and in a phone notification, so it
 * carries only the verdict. Everything else goes in the thread, which keeps
 * the channel readable when nothing is wrong.
 */
export function reportParentMessage(params: {
  report: PeriodReport;
  traffic: TrafficSummary | null;
  period: "daily" | "weekly";
  previousUptimePct?: number;
}): SlackPayload {
  const { report, traffic, period, previousUptimePct } = params;
  const label = period === "daily" ? report.from.toUTCString().slice(0, 16) : `${report.from.toISOString().slice(0, 10)} → ${report.to.toISOString().slice(0, 10)}`;
  const down = report.services.filter((s) => s.currentlyDown);
  const emoji = down.length ? "🔴" : report.totalIncidents > 0 ? "🟡" : "🟢";

  const trend =
    previousUptimePct === undefined
      ? ""
      : (() => {
          const delta = report.overallUptimePct - previousUptimePct;
          if (Math.abs(delta) < 0.005) return " (→ flat)";
          return ` (${delta > 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(3)} pts)`;
        })();

  const facts = [
    `*${formatPercent(report.overallUptimePct)}* uptime${trend}`,
    `${report.totalIncidents} incident${report.totalIncidents === 1 ? "" : "s"}`,
    `${report.services.length - down.length}/${report.services.length} services healthy now`,
  ];
  if (traffic) facts.push(`${traffic.views.toLocaleString("en-US")} visits`);

  const blocks: SlackBlock[] = [
    header(`${emoji} Sentinel uptime report — ${label}`),
    section(facts.join(" · ")),
  ];

  if (down.length) {
    blocks.push(
      section(`:rotating_light: *Currently unhealthy:* ${down.map((s) => s.name).join(", ")}`),
    );
  }

  blocks.push(context("Full breakdown in the thread below :thread:"));
  const link = dashboardLink();
  if (link) blocks.push(context(link));

  return {
    text: `${emoji} Sentinel uptime report — ${formatPercent(report.overallUptimePct)} uptime, ${report.totalIncidents} incident${report.totalIncidents === 1 ? "" : "s"}${traffic ? `, ${traffic.views.toLocaleString("en-US")} visits` : ""}`,
    blocks,
  };
}

/**
 * The detail posted as replies inside the report thread.
 *
 * Split into focused replies rather than one wall of text: on a phone each is
 * a separate readable card, and "which service was down and for how long"
 * should never require scrolling past a latency table to find.
 */
export function reportThreadMessages(params: {
  report: PeriodReport;
  traffic: TrafficSummary | null;
  deltas?: Map<string, number>;
  storage?: StorageSummary | null;
}): SlackPayload[] {
  const { report, traffic, deltas, storage } = params;
  const messages: SlackPayload[] = [];
  const windowLabel = formatDuration(report.windowSecs);

  // 1 — per-service health.
  const healthy = report.services.filter((s) => s.downtimeSecs === 0 && !s.currentlyDown);
  messages.push({
    text: "Service health",
    blocks: [
      section(`*:bar_chart: Service health — last ${windowLabel}*`),
      context("```" + reportTableLines(report.services, deltas).join("\n") + "```"),
      context(
        `${healthy.length} of ${report.services.length} services had a perfect window · ` +
          `total downtime across all services: *${report.totalDowntimeSecs ? formatDuration(report.totalDowntimeSecs) : "none"}*`,
      ),
    ],
  });

  // 2 — unhealthy periods, with the times and the recovery durations.
  const unhealthy = report.services.filter((s) => s.downtimeSecs > 0 || s.currentlyDown);
  if (unhealthy.length || report.incidents.length) {
    const perService = unhealthy.map((s) => {
      const upFor = formatDuration(Math.max(0, report.windowSecs - s.downtimeSecs));
      return (
        `• *${s.name}* — down *${formatDuration(s.downtimeSecs)}*, up ${upFor} ` +
        `(${formatPercent(s.uptimePct)}) across ${s.incidents} incident${s.incidents === 1 ? "" : "s"}` +
        `${s.currentlyDown ? " — *still down*" : ""}`
      );
    });

    const timeline = report.incidents.slice(0, 20).map((incident) => {
      const ongoing = incident.ended_at === null;
      const duration = formatDuration(
        secondsBetween(incident.started_at, incident.ended_at ?? report.to),
      );
      const recovery = ongoing ? "not recovered yet" : `back up after *${duration}*`;
      return (
        `• *${serviceName(incident.service_id)}* went down at *${formatUtc(incident.started_at)}*` +
        `${ongoing ? "" : `, recovered at *${formatUtc(incident.ended_at!)}*`} — ${recovery}\n` +
        `   └ ${incident.failed_checks} failed checks · \`${incident.error ?? "unknown"}\``
      );
    });

    messages.push({
      text: "Unhealthy services",
      blocks: [
        section(`*:warning: Unhealthy services — last ${windowLabel}*`),
        ...(perService.length ? [section(perService.join("\n"))] : []),
        ...(timeline.length
          ? [section(`*Timeline (all times UTC)*\n${timeline.join("\n")}`)]
          : []),
        context(
          `Mean time to recovery: *${report.mttrSecs !== null ? formatDuration(report.mttrSecs) : "—"}*` +
            (report.longest?.ended_at
              ? ` · longest outage: *${serviceName(report.longest.service_id)}* ${formatDuration(secondsBetween(report.longest.started_at, report.longest.ended_at))}`
              : ""),
        ),
      ],
    });
  } else {
    messages.push({
      text: "No unhealthy services",
      blocks: [
        section(`*:white_check_mark: No unhealthy services — last ${windowLabel}*`),
        context(
          `Every service answered every check. Full uptime for ${windowLabel} across all ${report.services.length} services.`,
        ),
      ],
    });
  }

  // 3 — traffic.
  if (traffic) {
    const delta = traffic.views - traffic.previousViews;
    const arrow = delta === 0 ? "→" : delta > 0 ? "▲" : "▼";
    const pct =
      traffic.previousViews > 0
        ? ` (${arrow} ${Math.abs(Math.round((delta / traffic.previousViews) * 100))}%)`
        : "";
    const top = traffic.topPaths
      .slice(0, 5)
      .map((p) => `• \`${p.label}\` — ${p.views.toLocaleString("en-US")}`);

    messages.push({
      text: "Traffic",
      blocks: [
        section(`*:chart_with_upwards_trend: Frontend traffic — last ${windowLabel}*`),
        fields([
          ["Visits", `${traffic.views.toLocaleString("en-US")}${pct}`],
          ["Previous period", traffic.previousViews.toLocaleString("en-US")],
        ]),
        ...(top.length ? [section(`*Top pages*\n${top.join("\n")}`)] : []),
      ],
    });
  }

  // 4 — the monitor's own coverage and storage headroom.
  const missed = missedTicksNote(report);
  if (missed || storage) {
    const blocks: SlackBlock[] = [section("*:mag: Monitor health*")];
    if (missed) blocks.push(context(missed));
    if (storage) {
      const mb = (b: number) => `${(b / (1024 * 1024)).toFixed(1)} MB`;
      const icon = storage.usedPct >= 92 ? ":red_circle:" : storage.usedPct >= 60 ? ":large_yellow_circle:" : ":large_green_circle:";
      blocks.push(
        fields([
          ["Database", `${icon} ${mb(storage.usedBytes)} of ${mb(storage.limitBytes)} (${storage.usedPct.toFixed(1)}%)`],
          ["Retention mode", storage.tier],
        ]),
      );
      if (storage.usedPct >= 60) {
        blocks.push(
          context(
            "Retention has tightened automatically to stay inside the free tier. Daily rollups are kept forever, so uptime percentages and visit totals are unaffected — only raw per-check detail is shortened.",
          ),
        );
      }
    }
    messages.push({ text: "Monitor health", blocks });
  }

  return messages;
}

/**
 * 💸 The money path stopped working, while every service stayed up.
 *
 * Deliberately worded to make that distinction the headline: an on-call
 * responder who reads "all services healthy" and stops there will miss the
 * fact that nobody is being billed.
 */
export function moneyDownMessage(params: {
  summary: string;
  health: {
    metering?: { pending: number; stream_length: number; consumers: number } | undefined;
    settlements?: { stuck_reserved: number; held_rows: number; held_units: number } | undefined;
  };
  at: Date;
}): SlackPayload {
  const { summary, health, at } = params;
  const blocks: SlackBlock[] = [
    header("💸 MONEY PATH DEGRADED"),
    section(`*${summary}*`),
    fields([
      ["Detected", formatUtc(at)],
      [
        "Unacked metering events",
        health.metering ? health.metering.pending.toLocaleString("en-US") : "—",
      ],
      [
        "Settlements holding funds",
        health.settlements
          ? `${health.settlements.held_rows} (${health.settlements.held_units.toLocaleString("en-US")} units)`
          : "—",
      ],
      ["Metering consumers", health.metering ? String(health.metering.consumers) : "—"],
    ]),
    context(
      "*Every service can still be UP while this is broken* — calls execute and return 200, but buyers are not billed and sellers are not paid.",
    ),
    context(
      "*Check:* `docker logs sentinel-billing --tail 100` · is the Celery worker running (`drain_metering_stream`, settlement reaper)?",
    ),
  ];

  const link = dashboardLink();
  if (link) blocks.push(context(link));

  return { text: `💸 MONEY PATH DEGRADED — ${summary}`, blocks };
}

/** 💚 The money path recovered. */
export function moneyRecoveredMessage(params: { at: Date; downSince: Date | null }): SlackPayload {
  const duration = params.downSince
    ? formatDuration(secondsBetween(params.downSince, params.at))
    : null;
  return {
    text: `💚 Money path recovered${duration ? ` after ${duration}` : ""}`,
    blocks: [
      header("💚 Money path RECOVERED"),
      section(
        `Metering is draining and no settlements are stranded${duration ? ` — degraded for *${duration}*` : ""}.`,
      ),
      context(
        "Confirm nothing was lost: the metering stream is at-least-once, so a backlog drains rather than disappears.",
      ),
    ],
  };
}

/** Resolve a service definition for alert copy, tolerating unknown ids. */
export function serviceForAlert(serviceId: string): ServiceDef {
  return (
    getService(serviceId) ?? {
      id: serviceId,
      name: serviceId,
      kind: "direct",
      port: 0,
      host: "server",
      summary: "",
      impact: "Unknown service — not in the inventory.",
      debug: `docker logs sentinel-${serviceId} --tail 100`,
    }
  );
}
