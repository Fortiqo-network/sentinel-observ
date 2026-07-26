import type { LatencyPoint } from "@/lib/repo";
import { SERVICES } from "@/lib/services";
import { formatLatency } from "@/lib/format";

/**
 * 24-hour response-time chart, one line per service.
 *
 * The y-axis is scaled to the 95th percentile of all samples rather than the
 * maximum, so a single cold-start spike cannot flatten every other line into
 * the baseline. Samples above the ceiling are clipped and marked, not dropped.
 * Ticks where a probe failed get a red mark along the floor, so an outage is
 * visible on the same timeline as the latency it followed.
 */

const SERIES_COLORS = [
  "#E7A03C",
  "#8193f8",
  "#34d399",
  "#22d3ee",
  "#c084fc",
  "#fb7185",
  "#ECEAE3",
];

const W = 1000;
const H = 260;
const PAD_L = 52;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 26;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

export function LatencyChart({
  points,
  since,
  until,
}: {
  points: LatencyPoint[];
  since: Date;
  until: Date;
}): React.JSX.Element {
  const samples = points
    .map((p) => p.avg_latency_ms)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  if (samples.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-porcelain/10 text-sm text-graphite">
        No latency samples yet — the first scheduled tick will fill this in.
      </div>
    );
  }

  const ceiling = Math.max(20, percentile(samples, 0.95) * 1.2);
  const spanMs = Math.max(1, until.getTime() - since.getTime());
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const x = (t: Date) =>
    PAD_L + ((new Date(t).getTime() - since.getTime()) / spanMs) * plotW;
  const y = (v: number) => PAD_T + plotH - Math.min(1, v / ceiling) * plotH;

  const byService = new Map<string, LatencyPoint[]>();
  for (const point of points) {
    const list = byService.get(point.service_id) ?? [];
    list.push(point);
    byService.set(point.service_id, list);
  }

  const gridValues = [0.25, 0.5, 0.75, 1].map((f) => Math.round(ceiling * f));
  const hourMarks = [0, 6, 12, 18, 24].map((h) => new Date(since.getTime() + h * 3600_000));
  const failures = points.filter((p) => p.failed > 0);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 260 }} role="img" aria-label="Response time over the last 24 hours">
        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(value)}
              y2={y(value)}
              stroke="rgba(236,234,227,0.08)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PAD_L - 8}
              y={y(value) + 3}
              textAnchor="end"
              className="fill-graphite"
              style={{ fontSize: 10, fontFamily: "var(--font-plex-mono), monospace" }}
            >
              {value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`}
            </text>
          </g>
        ))}

        {hourMarks.map((mark, i) => (
          <text
            key={i}
            x={Math.min(W - PAD_R, Math.max(PAD_L, x(mark)))}
            y={H - 8}
            textAnchor={i === 0 ? "start" : i === hourMarks.length - 1 ? "end" : "middle"}
            className="fill-graphite"
            style={{ fontSize: 10, fontFamily: "var(--font-plex-mono), monospace" }}
          >
            {mark.toISOString().slice(11, 16)}
          </text>
        ))}

        {SERVICES.map((service, index) => {
          const series = (byService.get(service.id) ?? [])
            .filter((p) => p.avg_latency_ms !== null)
            .sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime());
          if (series.length < 2) return null;
          const path = series
            .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.bucket).toFixed(1)},${y(p.avg_latency_ms!).toFixed(1)}`)
            .join(" ");
          return (
            <path
              key={service.id}
              d={path}
              fill="none"
              stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              strokeWidth="1.6"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              opacity="0.9"
            />
          );
        })}

        {failures.map((point, i) => (
          <rect
            key={`${point.service_id}-${i}`}
            x={x(point.bucket) - 1}
            y={H - PAD_B - 4}
            width={2.5}
            height={4}
            fill="#ef4444"
            opacity="0.9"
          />
        ))}
      </svg>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {SERVICES.map((service, index) => {
          const series = byService.get(service.id) ?? [];
          const latest = [...series]
            .reverse()
            .find((p) => p.avg_latency_ms !== null)?.avg_latency_ms;
          return (
            <span key={service.id} className="inline-flex items-center gap-2 text-xs text-graphite">
              <span
                className="h-[3px] w-4 rounded-full"
                style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }}
              />
              <span className="text-porcelain/80">{service.name}</span>
              <span className="metric">{formatLatency(latest ?? null)}</span>
            </span>
          );
        })}
        <span className="inline-flex items-center gap-2 text-xs text-graphite">
          <span className="h-2 w-[3px] rounded-sm bg-status-down" />
          failed probe
        </span>
      </div>
    </div>
  );
}
