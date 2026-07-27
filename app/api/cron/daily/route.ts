import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { hasDatabase } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { pruneChecks, prunePageviews, recordRun } from "@/lib/repo";
import { buildPeriodReport, persistDailyRollups } from "@/lib/rollup";
import { collectTraffic, postThreadedReport } from "@/lib/report";
import { isSlackConfigured } from "@/lib/slack";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_RETENTION_DAYS = 90;
const PAGEVIEW_RETENTION_DAYS = 365;

/**
 * Daily summary job.
 *
 * Reports on the trailing 24 hours (not a calendar day) so the numbers are
 * always complete regardless of what hour the schedule fires in, then persists
 * yesterday's rollup row and prunes raw checks past the retention window.
 */
async function handle(req: Request): Promise<NextResponse> {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "DATABASE_URL not set — reports need persisted history" },
      { status: 503 },
    );
  }

  const startedAt = Date.now();
  await ensureSchema();

  const to = new Date();
  const from = new Date(to.getTime() - DAY_MS);
  const report = await buildPeriodReport(from, to);

  await persistDailyRollups(new Date(to.getTime() - DAY_MS));
  const pruned = await pruneChecks(CHECK_RETENTION_DAYS);
  const prunedViews = await prunePageviews(PAGEVIEW_RETENTION_DAYS);

  let posted = false;
  let threadReplies = 0;
  let postError: string | null = null;
  if (isSlackConfigured()) {
    const result = await postThreadedReport({
      report,
      traffic: await collectTraffic(from, to),
      period: "daily",
    });
    posted = result.posted;
    threadReplies = result.threadReplies;
    postError = result.error;
  } else {
    postError = "Slack is not configured";
  }

  await recordRun({
    kind: "daily",
    durationMs: Date.now() - startedAt,
    servicesUp: report.services.filter((s) => !s.currentlyDown).length,
    servicesTotal: report.services.length,
    alertsSent: posted ? 1 : 0,
    error: postError,
  });

  return NextResponse.json({
    window: { from: from.toISOString(), to: to.toISOString() },
    overallUptimePct: report.overallUptimePct,
    incidents: report.totalIncidents,
    ticks: { actual: report.ticksActual, expected: report.ticksExpected },
    prunedChecks: pruned,
    prunedPageviews: prunedViews,
    posted,
    threadReplies,
    postError,
  });
}

export const GET = handle;
export const POST = handle;
