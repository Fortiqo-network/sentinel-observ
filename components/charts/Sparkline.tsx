import { cn } from "@/lib/utils/cn";

/**
 * Tiny latency trend line for a service card. Values are drawn on a normalized
 * 0–1 scale, so the shape shows the trend rather than inviting a false
 * comparison between services with different latency baselines.
 */
export function Sparkline({
  values,
  stroke = "#E7A03C",
  className,
  width = 160,
  height = 36,
}: {
  values: Array<number | null>;
  stroke?: string;
  className?: string;
  width?: number;
  height?: number;
}): React.JSX.Element | null {
  const points = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (points.length < 2) {
    return (
      <div
        className={cn("flex items-center font-brand-mono text-[10px] text-graphite", className)}
        style={{ height }}
      >
        not enough samples
      </div>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const gradientId = `spark-${stroke.replace("#", "")}`;

  const coords = points.map((value, i) => {
    const x = i * step;
    const y = height - ((value - min) / span) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${coords.join(" ")} ${width},${height}`}
        fill={`url(#${gradientId})`}
      />
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
