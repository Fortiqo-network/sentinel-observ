import type { TrafficBucket } from "@/lib/repo";
import { HoverBars, type HoverBar } from "./HoverBars";

/**
 * Hourly visit volume over the last 24 hours.
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
    return { at, views: byHour.get(at.toISOString().slice(0, 13)) ?? 0 };
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

  const bars: HoverBar[] = hours.map((hour) => ({
    key: hour.at.toISOString(),
    fraction: hour.views / peak,
    className: "bg-gold/70",
    label: `${hour.at.toISOString().slice(11, 13)}:00 UTC`,
    value: `${hour.views.toLocaleString("en-US")} ${hour.views === 1 ? "visit" : "visits"}`,
    detail: hour.at.toISOString().slice(0, 10),
  }));

  return (
    <div>
      <HoverBars bars={bars} heightClass="h-[180px]" />
      <div className="mt-2 flex items-center justify-between font-brand-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
        <span>{hours[0].at.toISOString().slice(11, 16)} UTC</span>
        <span>peak {peak}/h · {total.toLocaleString("en-US")} total</span>
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
  const total = rows.reduce((sum, r) => sum + r.views, 0);

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label} title={`${row.label} — ${row.views.toLocaleString("en-US")} visits`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate font-brand-mono text-xs text-porcelain/85">{row.label}</span>
            <span className="metric shrink-0 text-xs text-graphite">
              {row.views.toLocaleString("en-US")}
              <span className="ml-1.5 opacity-60">
                {Math.round((row.views / total) * 100)}%
              </span>
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
