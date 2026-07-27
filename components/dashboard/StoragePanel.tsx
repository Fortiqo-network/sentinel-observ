import { Panel } from "@/components/ui/Panel";
import { formatBytes, type StorageUsage } from "@/lib/storage";
import { cn } from "@/lib/utils/cn";

const TABLE_LABELS: Record<string, string> = {
  checks: "Raw checks",
  pageviews: "Raw pageviews",
  pageview_daily: "Traffic rollup",
  incidents: "Incidents",
  daily_rollups: "Uptime rollup",
  monitor_runs: "Cron runs",
  service_state: "Service state",
};

/**
 * Free-tier storage headroom.
 *
 * Shown as a first-class panel because the ceiling is hard: a full database
 * stops accepting checks, which would take the monitor down silently. The
 * retention tier is displayed alongside so a tightened window is visible as a
 * deliberate response rather than looking like lost data.
 */
export function StoragePanel({ usage }: { usage: StorageUsage }): React.JSX.Element {
  const tone =
    usage.usedPct >= 92
      ? { bar: "bg-status-down", text: "text-status-down" }
      : usage.usedPct >= 60
        ? { bar: "bg-status-degraded", text: "text-status-degraded" }
        : { bar: "bg-status-up", text: "text-status-up" };

  const biggest = usage.tables.filter((t) => t.bytes > 0).slice(0, 5);

  return (
    <Panel
      eyebrow="Free tier"
      title="Database storage"
      action={
        <span className="font-brand-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
          {usage.tier.name} retention
        </span>
      }
    >
      <div className="flex items-baseline justify-between">
        <span className={cn("metric text-2xl font-semibold", tone.text)}>
          {formatBytes(usage.totalBytes)}
        </span>
        <span className="metric text-xs text-graphite">
          of {formatBytes(usage.limitBytes)} · {usage.usedPct.toFixed(1)}%
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-porcelain/10">
        <div
          className={cn("h-full rounded-full transition-all", tone.bar)}
          style={{ width: `${Math.max(1, Math.min(100, usage.usedPct))}%` }}
        />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-graphite">
        Retention tightens automatically as usage climbs. Daily rollups are kept forever, so uptime
        percentages and visit totals never change — only how far back raw per-check detail goes.
        Current windows: {usage.tier.checks} d checks · {usage.tier.pageviewsRaw} d raw pageviews.
      </p>

      {biggest.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-porcelain/[0.07] pt-3">
          {biggest.map((table) => (
            <li key={table.table} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-porcelain/80">{TABLE_LABELS[table.table] ?? table.table}</span>
              <span className="metric text-graphite">
                {formatBytes(table.bytes)} · {table.rows.toLocaleString("en-US")} rows
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
