import { hasDatabase } from "./db";
import { ensureSchema } from "./schema";
import { claimReportPeriod, getLastRunAt, recordRun, releaseReportPeriod } from "./repo";
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

/** The period a daily report belongs to: the UTC date of its anchor. */
function dailyPeriodKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The period a weekly report belongs to: the UTC date of that week's Monday.
 * Keying on the week rather than "7 days since the last one" means a late run
 * still lands in the right bucket instead of shifting every subsequent week.
 */
function weeklyPeriodKey(now: Date): string {
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dayOfWeek = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - dayOfWeek);
  return monday.toISOString().slice(0, 10);
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

/**
 * Build and post the daily uptime report, then enforce the storage budget.
 *
 * Exactly-once per UTC day unless `force` is set. Both the health tick's
 * overdue check and a (possibly hours-late) scheduled call land here, so the
 * period claim — not the caller — is what prevents a duplicate.
 */
export async function runDailyReport(
  now = new Date(),
  { force = false }: { force?: boolean } = {},
): Promise<JobResult> {
  if (!hasDatabase()) {
    return { ran: false, skipped: "DATABASE_URL not set — reports need persisted history" };
  }

  const startedAt = Date.now();
  await ensureSchema();

  const periodKey = dailyPeriodKey(now);
  if (!force) {
    // Two guards, deliberately. The due check reads history, which also covers
    // periods produced before claims existed; the claim is atomic, which is what
    // actually stops two simultaneous callers. Neither alone is sufficient.
    if (!(await isDailyDue(now))) {
      return { ran: false, skipped: `daily report for ${periodKey} was already produced` };
    }
    if (!(await claimReportPeriod("daily", periodKey))) {
      return { ran: false, skipped: `daily report for ${periodKey} is already being produced` };
    }
  }

  const to = now;
  const from = new Date(to.getTime() - DAY_MS);

  let report;
  let storage;
  try {
    report = await buildPeriodReport(from, to);
    await persistDailyRollups(new Date(to.getTime() - DAY_MS));
    storage = await enforceStorageBudget();
  } catch (err) {
    // Give the period back, or a transient failure would silently cost the
    // whole day's report.
    if (!force) await releaseReportPeriod("daily", periodKey);
    throw err;
  }

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

/**
 * Build and post the weekly uptime report, with the week-over-week trend.
 * Exactly-once per ISO week unless `force` is set — see {@link runDailyReport}.
 */
export async function runWeeklyReport(
  now = new Date(),
  { force = false }: { force?: boolean } = {},
): Promise<JobResult> {
  if (!hasDatabase()) {
    return { ran: false, skipped: "DATABASE_URL not set — reports need persisted history" };
  }

  const startedAt = Date.now();
  await ensureSchema();

  const periodKey = weeklyPeriodKey(now);
  if (!force) {
    if (!(await isWeeklyDue(now))) {
      return { ran: false, skipped: `weekly report for week of ${periodKey} was already produced` };
    }
    if (!(await claimReportPeriod("weekly", periodKey))) {
      return {
        ran: false,
        skipped: `weekly report for week of ${periodKey} is already being produced`,
      };
    }
  }

  const to = now;
  const from = new Date(to.getTime() - WEEK_MS);
  const previousFrom = new Date(from.getTime() - WEEK_MS);

  let report;
  let previous;
  try {
    [report, previous] = await Promise.all([
      buildPeriodReport(from, to),
      buildPeriodReport(previousFrom, from),
    ]);
  } catch (err) {
    if (!force) await releaseReportPeriod("weekly", periodKey);
    throw err;
  }

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

  // The due checks here are a cheap filter only — `runDailyReport` re-checks and
  // claims atomically, so a tick racing a late scheduled call still produces
  // exactly one report.
  try {
    if (await isDailyDue(now)) {
      const result = await runDailyReport(now);
      if (result.ran) out.daily = result;
    }
  } catch (err) {
    out.daily = { ran: false, skipped: err instanceof Error ? err.message : String(err) };
  }

  try {
    if (await isWeeklyDue(now)) {
      const result = await runWeeklyReport(now);
      if (result.ran) out.weekly = result;
    }
  } catch (err) {
    out.weekly = { ran: false, skipped: err instanceof Error ? err.message : String(err) };
  }

  return out;
}
