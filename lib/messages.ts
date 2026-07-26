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

function incidentLines(report: PeriodReport, limit: number): string[] {
  return report.incidents.slice(0, limit).map((incident) => {
    const end = incident.ended_at
      ? formatUtcTime(incident.ended_at)
      : "ongoing";
    const duration = formatDuration(
      secondsBetween(incident.started_at, incident.ended_at ?? report.to),
    );
    return `• *${serviceName(incident.service_id)}* ${formatUtcTime(incident.started_at)}–${end} (${duration}) — \`${incident.error ?? "unknown"}\``;
  });
}

function missedTicksNote(report: PeriodReport): string | null {
  if (report.ticksExpected === 0) return null;
  const missed = report.ticksExpected - report.ticksActual;
  if (missed < Math.max(5, report.ticksExpected * 0.05)) return null;
  return `⚠️ The monitor itself missed ~${missed} of ${report.ticksExpected} scheduled ticks — check the GitHub Actions schedule.`;
}

/** 📊 Daily summary. */
export function dailyReportMessage(report: PeriodReport): SlackPayload {
  const day = report.from.toUTCString().slice(0, 16);
  const headline = `Overall *${formatPercent(report.overallUptimePct)}* uptime · ${report.totalIncidents} incident${report.totalIncidents === 1 ? "" : "s"}`;
  const worst = report.worst ? ` · worst: *${report.worst.name}*` : "";

  const blocks: SlackBlock[] = [
    header(`📊 Sentinel daily report — ${day}`),
    section(`${headline}${worst}`),
    context("```" + reportTableLines(report.services).join("\n") + "```"),
  ];

  const incidents = incidentLines(report, 10);
  blocks.push(
    incidents.length
      ? section(`*Incidents*\n${incidents.join("\n")}`)
      : context("No incidents in the last 24 hours."),
  );

  const missed = missedTicksNote(report);
  if (missed) blocks.push(context(missed));

  const link = dashboardLink();
  if (link) blocks.push(context(link));

  return {
    text: `📊 Sentinel daily report — ${formatPercent(report.overallUptimePct)} uptime, ${report.totalIncidents} incidents`,
    blocks,
  };
}

/** 📈 Weekly summary, with the trend against the previous week. */
export function weeklyReportMessage(params: {
  report: PeriodReport;
  deltas: Map<string, number>;
  previousUptimePct: number;
}): SlackPayload {
  const { report, deltas, previousUptimePct } = params;
  const delta = report.overallUptimePct - previousUptimePct;
  const arrow = Math.abs(delta) < 0.005 ? "→" : delta > 0 ? "▲" : "▼";
  const range = `${report.from.toISOString().slice(0, 10)} → ${report.to.toISOString().slice(0, 10)}`;

  const blocks: SlackBlock[] = [
    header(`📈 Sentinel weekly report — ${range}`),
    section(
      `Overall *${formatPercent(report.overallUptimePct)}* uptime ${arrow} ${Math.abs(delta).toFixed(3)} pts vs last week · ` +
        `${report.totalIncidents} incident${report.totalIncidents === 1 ? "" : "s"} · ` +
        `MTTR ${report.mttrSecs !== null ? formatDuration(report.mttrSecs) : "—"}`,
    ),
    context("```" + reportTableLines(report.services, deltas).join("\n") + "```"),
  ];

  if (report.longest && report.longest.ended_at) {
    blocks.push(
      section(
        `*Longest incident:* ${serviceName(report.longest.service_id)} — ` +
          `${formatDuration(secondsBetween(report.longest.started_at, report.longest.ended_at))} ` +
          `on ${formatUtc(report.longest.started_at)} (\`${report.longest.error ?? "unknown"}\`)`,
      ),
    );
  }

  const incidents = incidentLines(report, 15);
  blocks.push(
    incidents.length
      ? section(`*Incidents this week*\n${incidents.join("\n")}`)
      : context("No incidents this week. 🎉"),
  );

  const missed = missedTicksNote(report);
  if (missed) blocks.push(context(missed));

  const link = dashboardLink();
  if (link) blocks.push(context(link));

  return {
    text: `📈 Sentinel weekly report — ${formatPercent(report.overallUptimePct)} uptime, ${report.totalIncidents} incidents`,
    blocks,
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
