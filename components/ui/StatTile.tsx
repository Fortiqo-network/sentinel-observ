import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Headline metric tile. The value uses the mono brand face with tabular
 * figures so a row of tiles stays visually aligned as numbers change on
 * refresh.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
  className?: string;
}): React.JSX.Element {
  const valueTone = {
    neutral: "text-porcelain",
    good: "text-status-up",
    warn: "text-status-degraded",
    bad: "text-status-down",
    accent: "text-gold",
  }[tone];

  return (
    <div className={cn("panel panel-pad", className)}>
      <div className="eyebrow">{label}</div>
      <div className={cn("metric mt-2 text-2xl font-semibold tracking-tight sm:text-[28px]", valueTone)}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-graphite">{sub}</div>}
    </div>
  );
}
