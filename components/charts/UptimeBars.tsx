import type { DailyPoint } from "@/lib/repo";
import { HoverBars, type HoverBar } from "./HoverBars";

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

  const bars: HoverBar[] = cells.map((cell) => {
    const tone = toneFor(cell);
    const uptime = cell.total > 0 ? ((cell.total - cell.failed) / cell.total) * 100 : null;
    return {
      key: cell.day,
      // Uptime bars are categorical, not proportional: a full-height bar coloured
      // by outcome reads far faster than 99% vs 100% height differences.
      fraction: 1,
      className: tone.className,
      label: cell.day,
      value: uptime === null ? "No data" : `${uptime.toFixed(uptime === 100 ? 0 : 2)}% up`,
      detail:
        cell.total === 0
          ? "the monitor was not running"
          : `${cell.total - cell.failed}/${cell.total} checks passed`,
    };
  });

  return (
    <div className={className}>
      <HoverBars bars={bars} heightClass={height} minBarPct={100} />
      <div className="mt-2 flex items-center justify-between font-brand-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
        <span>{firstDay ?? `${days} days ago`}</span>
        <span>{withData.length} days recorded</span>
        <span>today</span>
      </div>
    </div>
  );
}
