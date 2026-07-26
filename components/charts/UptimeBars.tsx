import { cn } from "@/lib/utils/cn";
import type { DailyPoint } from "@/lib/repo";

/**
 * The 90-day uptime strip — one bar per day, green when every check passed,
 * amber for a partial day, red for a bad day, hollow when the monitor has no
 * data for that day yet.
 *
 * Days with no row are rendered as gaps rather than as "up", so a period when
 * the monitor itself was not running never reads as a clean record.
 */

type DayCell = { day: string; total: number; failed: number };

function toneFor(cell: DayCell): { className: string; label: string } {
  if (cell.total === 0) {
    return { className: "bg-porcelain/[0.07]", label: "no data" };
  }
  const failRatio = cell.failed / cell.total;
  if (failRatio === 0) return { className: "bg-status-up/80", label: "100% up" };
  if (failRatio < 0.05) return { className: "bg-status-degraded/85", label: "partial outage" };
  return { className: "bg-status-down/90", label: "major outage" };
}

function buildCells(points: DailyPoint[], days: number): DayCell[] {
  const byDay = new Map(points.map((p) => [p.day, p]));
  const cells: DayCell[] = [];
  const today = new Date();

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i),
    );
    const key = date.toISOString().slice(0, 10);
    const point = byDay.get(key);
    cells.push({
      day: key,
      total: point?.total_checks ?? 0,
      failed: point?.failed_checks ?? 0,
    });
  }
  return cells;
}

export function UptimeBars({
  points,
  days = 90,
  height = "h-8",
  className,
}: {
  points: DailyPoint[];
  days?: number;
  height?: string;
  className?: string;
}): React.JSX.Element {
  const cells = buildCells(points, days);
  const withData = cells.filter((c) => c.total > 0);
  const firstDay = withData[0]?.day;

  return (
    <div className={className}>
      <div className={cn("flex items-stretch gap-[2px]", height)}>
        {cells.map((cell) => {
          const tone = toneFor(cell);
          return (
            <div
              key={cell.day}
              title={`${cell.day} — ${tone.label}${cell.total ? ` (${cell.total - cell.failed}/${cell.total} checks ok)` : ""}`}
              className={cn(
                "min-w-[2px] flex-1 rounded-[2px] transition-opacity hover:opacity-70",
                tone.className,
              )}
            />
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between font-brand-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
        <span>{firstDay ?? `${days} days ago`}</span>
        <span>{withData.length} days recorded</span>
        <span>today</span>
      </div>
    </div>
  );
}
