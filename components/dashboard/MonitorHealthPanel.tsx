import type { MonitorHealth } from "@/lib/dashboard";
import { Panel } from "@/components/ui/Panel";
import { formatDuration, formatUtc, secondsBetween } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

/**
 * Who watches the watcher.
 *
 * A monitor that silently stops running looks identical to a platform with no
 * incidents, so the delivered-vs-expected tick count is shown as a first-class
 * metric rather than buried in logs.
 */
export function MonitorHealthPanel({
  monitor,
  now,
}: {
  monitor: MonitorHealth;
  now: Date;
}): React.JSX.Element {
  const coverage = monitor.ticksExpected
    ? Math.min(100, (monitor.ticks24h / monitor.ticksExpected) * 100)
    : 0;
  const healthy = coverage >= 95;
  const staleSecs = monitor.lastRunAt ? secondsBetween(monitor.lastRunAt, now) : null;
  const stale = staleSecs !== null && staleSecs > 15 * 60;

  return (
    <Panel eyebrow="Self-check" title="Monitor health">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-graphite">Scheduled ticks, last 24 h</span>
            <span
              className={cn(
                "metric text-sm",
                healthy ? "text-status-up" : "text-status-degraded",
              )}
            >
              {monitor.ticks24h} / {monitor.ticksExpected}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-porcelain/10">
            <div
              className={cn("h-full rounded-full", healthy ? "bg-status-up" : "bg-status-degraded")}
              style={{ width: `${Math.max(2, coverage)}%` }}
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-graphite">
            {monitor.ticks24h === 0
              ? "No scheduled runs recorded yet — add the GitHub Actions workflow and its CRON_SECRET."
              : healthy
                ? "The scheduler is delivering ticks on cadence."
                : `About ${monitor.ticksExpected - monitor.ticks24h} ticks were missed. GitHub schedules drift under load; a persistent gap means the workflow is failing.`}
          </p>
        </div>

        <dl className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-graphite">Last run</dt>
            <dd className={cn("metric text-sm", stale ? "text-status-degraded" : "text-porcelain")}>
              {monitor.lastRunAt ? formatUtc(monitor.lastRunAt) : "never"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-graphite">Age</dt>
            <dd className="metric text-sm text-porcelain">
              {staleSecs === null ? "—" : formatDuration(staleSecs)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-graphite">Avg tick duration</dt>
            <dd className="metric text-sm text-porcelain">
              {monitor.avgDurationMs === null ? "—" : `${monitor.avgDurationMs} ms`}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-graphite">Slack alerts sent, 24 h</dt>
            <dd className="metric text-sm text-porcelain">{monitor.alertsSent24h}</dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}
