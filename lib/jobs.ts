import { hasDatabase } from "./db";
import { ensureSchema } from "./schema";
import { getLastRunAt, recordRun } from "./repo";
import { buildPeriodReport, persistDailyRollups, uptimeDelta } from "./rollup";
import { collectTraffic, postThreadedReport } from "./report";
import { isSlackConfigured } from "./slack";
import { enforceStorageBudget, formatBytes } from "./storage";

/**
 * The periodic report jobs, and the rule for when they are overdue.
 *
 * These are deliberately *not* tied to a scheduler firing at an exact minute.
 * GitHub Actions drops and delays short-interval schedules heavily — in
 * practice the 5-minute tick has landed roughly hourly — so a report anchored
 * to "did 03:30 fire?" silently never happens. Instead every health tick asks
 * "is a report overdue?", which means any tick that runs after the anchor time
 * produces the report. Late is acceptable; missing is not.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** UTC hour/minute the reports are anchored to (03:30 UTC = 09:00 IST). */
const ANCHOR_HOUR = 3;
const ANCHOR_MINUTE = 30;

function anchorFor(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), ANCHOR_HOUR, ANCHOR_MINUTE),
  );
}

/**
 * True when today's report has not been produced yet and the anchor time has
 * passed. Comparing against the anchor rather than a rolling 24 h window keeps
 * the report at a predictable time of day instead of drifting earlier forever.
 */
export async function isDailyDue(now: Date): Promise<boolean> {
  const anchor = anchorFor(now);
  if (now < anchor) return false;
  const last = await getLastRunAt("daily");
  return last === null || last < anchor;
}

/** True when no weekly report has been produced in the last 7 days. */
export async function isWeeklyDue(now: Date): Promise<boolean> {
  if (now < anchorFor(now)) return false;
  const last = await getLastRunAt("weekly");
  return last === null || now.getTime() - last.getTime() >= WEEK_MS;
}

export type JobResult = {
  ran: boolean;
  skipped?: string;
  posted?: boolean;
  threadReplies?: number;
  postError?: string | null;
  details?: Record<string, unknown>;
};

/** Build and post the daily uptime report, then enforce the storage budget. */
export async function runDailyReport(now = new Date()): Promise<JobResult> {
  if (!hasDatabase()) {
    return { ran: false, skipped: "DATABASE_URL not set — reports need persisted history" };
  }

  const startedAt = Date.now();
  await ensureSchema();

  const to = now;
  const from = new Date(to.getTime() - DAY_MS);
  const report = await buildPeriodReport(from, to);

  await persistDailyRollups(new Date(to.getTime() - DAY_MS));
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

  return {
    ran: true,
    posted,
    threadReplies,
    postError,
    details: {
      window: { from: from.toISOString(), to: to.toISOString() },
      overallUptimePct: report.overallUptimePct,
      incidents: report.totalIncidents,
      ticks: { actual: report.ticksActual, expected: report.ticksExpected },
      storage: {
        used: formatBytes(storage.after.totalBytes),
        limit: formatBytes(storage.after.limitBytes),
        usedPct: Number(storage.after.usedPct.toFixed(2)),
        tier: storage.tier.name,
        pageviewsRolledUp: storage.pageviewsRolledUp,
        checksPruned: storage.checksPruned,
        runsPruned: storage.runsPruned,
      },
    },
  };
}

/** Build and post the weekly uptime report, with the week-over-week trend. */
export async function runWeeklyReport(now = new Date()): Promise<JobResult> {
  if (!hasDatabase()) {
    return { ran: false, skipped: "DATABASE_URL not set — reports need persisted history" };
  }

  const startedAt = Date.now();
  await ensureSchema();

  const to = now;
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

  return {
    ran: true,
    posted,
    threadReplies,
    postError,
    details: {
      window: { from: from.toISOString(), to: to.toISOString() },
      overallUptimePct: report.overallUptimePct,
      previousUptimePct: previous.overallUptimePct,
      incidents: report.totalIncidents,
      mttrSecs: report.mttrSecs,
    },
  };
}

/**
 * Run whichever periodic reports are overdue.
 *
 * Called at the end of every health tick, so the reports survive a scheduler
 * that only manages a handful of runs a day. Failures are swallowed: a broken
 * report must never fail the tick that detects outages.
 */
export async function runDueReports(now = new Date()): Promise<Record<string, JobResult>> {
  const out: Record<string, JobResult> = {};
  if (!hasDatabase()) return out;

  try {
    if (await isDailyDue(now)) out.daily = await runDailyReport(now);
  } catch (err) {
    out.daily = { ran: false, skipped: err instanceof Error ? err.message : String(err) };
  }

  try {
    if (await isWeeklyDue(now)) out.weekly = await runWeeklyReport(now);
  } catch (err) {
    out.weekly = { ran: false, skipped: err instanceof Error ? err.message : String(err) };
  }

  return out;
}
