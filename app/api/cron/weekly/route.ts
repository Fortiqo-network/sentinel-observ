import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { hasDatabase } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { recordRun } from "@/lib/repo";
import { buildPeriodReport, uptimeDelta } from "@/lib/rollup";
import { collectTraffic, postThreadedReport } from "@/lib/report";
import { isSlackConfigured } from "@/lib/slack";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Weekly summary job — the trailing 7 days plus a per-service trend against the
 * 7 days before that, MTTR, and the week's longest incident.
 */
async function handle(req: Request): Promise<NextResponse> {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  // Skipped rather than failed when unconfigured — see the note in the daily
  // route: a daily false alarm is worse than no report.
  if (!hasDatabase()) {
    return NextResponse.json({
      skipped: true,
      reason: "DATABASE_URL not set — reports need persisted history",
    });
  }

  const startedAt = Date.now();
  await ensureSchema();

  const to = new Date();
  const from = new Date(to.getTime() - WEEK_MS);
  const previousFrom = new Date(from.getTime() - WEEK_MS);

  const [report, previous] = await Promise.all([
    buildPeriodReport(from, to),
    buildPeriodReport(previousFrom, from),
  ]);

  let posted = false;
  let threadReplies = 0;
  let postError: string | null = null;
  if (isSlackConfigured()) {
    const result = await postThreadedReport({
      report,
      traffic: await collectTraffic(from, to),
      period: "weekly",
      deltas: uptimeDelta(report, previous),
      previousUptimePct: previous.overallUptimePct,
    });
    posted = result.posted;
    threadReplies = result.threadReplies;
    postError = result.error;
  } else {
    postError = "Slack is not configured";
  }

  await recordRun({
    kind: "weekly",
    durationMs: Date.now() - startedAt,
    servicesUp: report.services.filter((s) => !s.currentlyDown).length,
    servicesTotal: report.services.length,
    alertsSent: posted ? 1 : 0,
    error: postError,
  });

  return NextResponse.json({
    window: { from: from.toISOString(), to: to.toISOString() },
    overallUptimePct: report.overallUptimePct,
    previousUptimePct: previous.overallUptimePct,
    incidents: report.totalIncidents,
    mttrSecs: report.mttrSecs,
    posted,
    threadReplies,
    postError,
  });
}

export const GET = handle;
export const POST = handle;
