import Link from "next/link";
import type { ServiceCard as ServiceCardData } from "@/lib/dashboard";
import type { LatencyPoint } from "@/lib/repo";
import { Sparkline } from "@/components/charts/Sparkline";
import { StatusDot, statusLabel } from "@/components/ui/StatusDot";
import { formatDuration, formatLatency, formatPercent, secondsBetween } from "@/lib/format";
import { serviceEndpoint } from "@/lib/services";
import { cn } from "@/lib/utils/cn";

const TONE = {
  up: { border: "border-porcelain/10", accent: "#22c55e", text: "text-status-up" },
  down: { border: "border-status-down/40", accent: "#ef4444", text: "text-status-down" },
  maintenance: {
    border: "border-status-maintenance/40",
    accent: "#6366f1",
    text: "text-status-maintenance",
  },
  unknown: { border: "border-porcelain/10", accent: "#4A4E58", text: "text-graphite" },
} as const;

function UptimeCell({ label, value }: { label: string; value: number | null }): React.JSX.Element {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="metric mt-0.5 text-sm text-porcelain">
        {value === null ? "—" : formatPercent(value)}
      </div>
    </div>
  );
}

/**
 * One service tile: current state, how long it has held that state, uptime at
 * three horizons, latency trend, and the live failure reason when down.
 */
export function ServiceCard({
  card,
  latency,
  now,
}: {
  card: ServiceCardData;
  latency: LatencyPoint[];
  now: Date;
}): React.JSX.Element {
  const tone = TONE[card.status];
  const held = card.since ? formatDuration(secondsBetween(card.since, now)) : null;
  const series = latency
    .filter((p) => p.service_id === card.service.id)
    .sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime())
    .map((p) => p.avg_latency_ms);

  return (
    <Link
      href={`/services/${card.service.id}`}
      className={cn(
        "panel group block p-5 transition hover:border-gold/30 hover:bg-ink-800/70",
        tone.border,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={card.status} />
            <h3 className="truncate text-[15px] font-semibold tracking-tight text-porcelain">
              {card.service.name}
            </h3>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-graphite">
            {card.service.summary}
          </p>
        </div>
        <div className="text-right">
          <div className={cn("font-brand-mono text-[11px] uppercase tracking-[0.12em]", tone.text)}>
            {statusLabel(card.status)}
          </div>
          {held && <div className="mt-0.5 font-brand-mono text-[11px] text-graphite">{held}</div>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3">
        <UptimeCell label="24 h" value={card.uptime24h} />
        <UptimeCell label="7 d" value={card.uptime7d} />
        <UptimeCell label="30 d" value={card.uptime30d} />
        <div>
          <div className="eyebrow">latency</div>
          <div className="metric mt-0.5 text-sm text-porcelain">
            {formatLatency(card.live?.latencyMs ?? card.avgLatencyMs)}
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-porcelain/[0.07] pt-3">
        <Sparkline values={series} stroke={tone.accent} height={30} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 font-brand-mono text-[10px] uppercase tracking-[0.12em] text-graphite">
        <span className="truncate">
          {card.service.host === "vercel" ? "vercel" : `:${card.service.port}`} ·{" "}
          {card.service.kind === "direct" ? "direct probe" : "via gateway"}
        </span>
        <span className="shrink-0">
          p95 {formatLatency(card.p95LatencyMs)}
        </span>
      </div>

      {card.lastError && (
        <p
          className={cn(
            "mt-3 rounded-md px-2.5 py-2 font-brand-mono text-[11px] leading-relaxed",
            card.status === "unknown"
              ? "bg-porcelain/[0.04] text-graphite"
              : "bg-status-down/10 text-status-down",
          )}
        >
          {card.lastError}
        </p>
      )}

      <p className="sr-only">{serviceEndpoint(card.service)}</p>
    </Link>
  );
}
