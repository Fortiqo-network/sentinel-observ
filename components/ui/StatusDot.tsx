import { cn } from "@/lib/utils/cn";

export type StatusValue = "up" | "down" | "degraded" | "maintenance" | "unknown";

const TONE: Record<StatusValue, { dot: string; ring: string; text: string; label: string }> = {
  up: {
    dot: "bg-status-up",
    ring: "bg-status-up/60",
    text: "text-status-up",
    label: "Operational",
  },
  degraded: {
    dot: "bg-status-degraded",
    ring: "bg-status-degraded/60",
    text: "text-status-degraded",
    label: "Degraded",
  },
  down: {
    dot: "bg-status-down",
    ring: "bg-status-down/60",
    text: "text-status-down",
    label: "Down",
  },
  maintenance: {
    dot: "bg-status-maintenance",
    ring: "bg-status-maintenance/60",
    text: "text-status-maintenance",
    label: "Maintenance",
  },
  unknown: {
    dot: "bg-status-unknown",
    ring: "bg-status-unknown/60",
    text: "text-graphite",
    label: "Not monitored",
  },
};

/** A status dot; down and degraded states pulse so a red row catches the eye. */
export function StatusDot({
  status,
  className,
}: {
  status: StatusValue;
  className?: string;
}): React.JSX.Element {
  const tone = TONE[status];
  const pulses = status === "down" || status === "degraded";
  return (
    <span className={cn("relative inline-flex h-2.5 w-2.5 shrink-0", className)}>
      {pulses && (
        <span className={cn("absolute inset-0 rounded-full animate-pulse-ring", tone.ring)} />
      )}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", tone.dot)} />
    </span>
  );
}

/** Dot plus label, used in table rows and card headers. */
export function StatusPill({
  status,
  label,
  className,
}: {
  status: StatusValue;
  label?: string;
  className?: string;
}): React.JSX.Element {
  const tone = TONE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-porcelain/10 bg-ink-800/80 px-2.5 py-1",
        className,
      )}
    >
      <StatusDot status={status} />
      <span className={cn("font-brand-mono text-[11px] uppercase tracking-[0.12em]", tone.text)}>
        {label ?? tone.label}
      </span>
    </span>
  );
}

export function statusLabel(status: StatusValue): string {
  return TONE[status].label;
}
