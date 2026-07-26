import type { TrafficBucket } from "@/lib/repo";

/**
 * Hourly visit volume over the last 24 hours, as a column chart.
 *
 * Every hour in the window gets a column, including the empty ones — a gap
 * rendered as "no bar" reads as a quiet hour, which is true, whereas skipping
 * the hour entirely would silently compress the time axis and misrepresent when
 * traffic actually happened.
 */
export function TrafficChart({
  buckets,
  now,
}: {
  buckets: TrafficBucket[];
  now: Date;
}): React.JSX.Element {
  const byHour = new Map(
    buckets.map((b) => [new Date(b.bucket).toISOString().slice(0, 13), b.views]),
  );

  const hours = Array.from({ length: 24 }, (_, i) => {
    const at = new Date(now.getTime() - (23 - i) * 3600_000);
    const key = at.toISOString().slice(0, 13);
    return { at, views: byHour.get(key) ?? 0 };
  });

  const peak = Math.max(1, ...hours.map((h) => h.views));
  const total = hours.reduce((sum, h) => sum + h.views, 0);

  if (total === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-lg border border-dashed border-porcelain/10 text-sm text-graphite">
        No visits recorded in the last 24 hours.
      </div>
    );
  }

  return (
    <div>
      <div className="flex h-[180px] items-end gap-[3px]">
        {hours.map((hour) => (
          <div
            key={hour.at.toISOString()}
            title={`${hour.at.toISOString().slice(11, 13)}:00 UTC — ${hour.views} view${hour.views === 1 ? "" : "s"}`}
            className="group flex-1 rounded-t-[2px] bg-gold/70 transition hover:bg-gold"
            style={{ height: `${Math.max(hour.views === 0 ? 0 : 3, (hour.views / peak) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between font-brand-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
        <span>{hours[0].at.toISOString().slice(11, 16)} UTC</span>
        <span>peak {peak}/h</span>
        <span>now</span>
      </div>
    </div>
  );
}

/** Horizontal ranked bars for a single traffic dimension (path, referrer, country). */
export function BreakdownBars({
  rows,
  emptyMessage,
}: {
  rows: Array<{ label: string; views: number }>;
  emptyMessage: string;
}): React.JSX.Element {
  if (rows.length === 0) {
    return <p className="text-sm text-graphite">{emptyMessage}</p>;
  }
  const max = Math.max(...rows.map((r) => r.views), 1);

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate font-brand-mono text-xs text-porcelain/85" title={row.label}>
              {row.label}
            </span>
            <span className="metric shrink-0 text-xs text-graphite">
              {row.views.toLocaleString("en-US")}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-porcelain/[0.07]">
            <div
              className="h-full rounded-full bg-gold/60"
              style={{ width: `${Math.max(2, (row.views / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
