import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { hasDatabase } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { recordRun } from "@/lib/repo";
import { buildPeriodReport, persistDailyRollups } from "@/lib/rollup";
import { collectTraffic, postThreadedReport } from "@/lib/report";
import { isSlackConfigured } from "@/lib/slack";
import { enforceStorageBudget, formatBytes } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

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

  // A missing database is a configuration state, not a job failure. Returning
  // an error here would fail the scheduler every single day and page the alarm
  // channel with "the platform is UNWATCHED" — which is both untrue (the health
  // tick is unaffected) and the fastest way to train people to ignore alerts.
  // The dashboard's setup checklist already reports this.
  if (!hasDatabase()) {
    return NextResponse.json({
      skipped: true,
      reason: "DATABASE_URL not set — reports need persisted history",
    });
  }

  const startedAt = Date.now();
  await ensureSchema();

  const to = new Date();
  const from = new Date(to.getTime() - DAY_MS);
  const report = await buildPeriodReport(from, to);

  await persistDailyRollups(new Date(to.getTime() - DAY_MS));

  // Retention is driven by measured storage pressure rather than fixed windows,
  // so the free tier's 500 MB ceiling is enforced by the system instead of by
  // someone noticing a full database after writes have already started failing.
  const storage = await enforceStorageBudget();

  let posted = false;
  let threadReplies = 0;
  let postError: string | null = null;
  if (isSlackConfigured()) {
    const result = await postThreadedReport({
      report,
      traffic: await collectTraffic(from, to),
      period: "daily",
      storage: {
        usedBytes: storage.after.totalBytes,
        limitBytes: storage.after.limitBytes,
        usedPct: storage.after.usedPct,
        tier: storage.tier.name,
      },
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
    storage: {
      used: formatBytes(storage.after.totalBytes),
      limit: formatBytes(storage.after.limitBytes),
      usedPct: Number(storage.after.usedPct.toFixed(2)),
      tier: storage.tier.name,
      retentionDays: {
        checks: storage.tier.checks,
        pageviewsRaw: storage.tier.pageviewsRaw,
        monitorRuns: storage.tier.monitorRuns,
      },
      reclaimed: formatBytes(Math.max(0, storage.before.totalBytes - storage.after.totalBytes)),
      pageviewsRolledUp: storage.pageviewsRolledUp,
      checksPruned: storage.checksPruned,
      runsPruned: storage.runsPruned,
      stillOverBudget: storage.stillOverBudget,
    },
    posted,
    threadReplies,
    postError,
  });
}

export const GET = handle;
export const POST = handle;
