import Link from "next/link";
import type { IncidentRow } from "@/lib/repo";
import { serviceName } from "@/lib/services";
import { formatDuration, formatUtc, secondsBetween } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

/**
 * Incident log. Ongoing incidents are pinned to the top with a live duration —
 * an open outage should never be one row among many resolved ones.
 */
export function IncidentList({
  incidents,
  now,
  emptyMessage = "No incidents recorded. Every check has passed.",
  showService = true,
}: {
  incidents: IncidentRow[];
  now: Date;
  emptyMessage?: string;
  showService?: boolean;
}): React.JSX.Element {
  if (incidents.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-porcelain/10 px-4 py-6 text-sm text-graphite">
        <span className="h-2 w-2 rounded-full bg-status-up" />
        {emptyMessage}
      </div>
    );
  }

  const ordered = [...incidents].sort((a, b) => {
    if (!a.ended_at && b.ended_at) return -1;
    if (a.ended_at && !b.ended_at) return 1;
    return b.started_at.getTime() - a.started_at.getTime();
  });

  return (
    <ul className="divide-y divide-porcelain/[0.07]">
      {ordered.map((incident) => {
        const ongoing = incident.ended_at === null;
        const duration = formatDuration(
          secondsBetween(incident.started_at, incident.ended_at ?? now),
        );
        return (
          <li key={incident.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3.5">
            <span
              className={cn(
                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                ongoing ? "bg-status-down" : "bg-status-degraded/70",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                {showService && (
                  <Link
                    href={`/services/${incident.service_id}`}
                    className="text-sm font-semibold text-porcelain hover:text-gold"
                  >
                    {serviceName(incident.service_id)}
                  </Link>
                )}
                <span
                  className={cn(
                    "font-brand-mono text-[11px] uppercase tracking-[0.12em]",
                    ongoing ? "text-status-down" : "text-graphite",
                  )}
                >
                  {ongoing ? `ongoing · ${duration}` : `resolved · ${duration}`}
                </span>
                {incident.is_storm && (
                  <span className="rounded-full bg-gold/15 px-2 py-0.5 font-brand-mono text-[10px] uppercase tracking-[0.12em] text-gold">
                    platform outage
                  </span>
                )}
              </div>
              <p className="mt-1 break-words font-brand-mono text-[11px] leading-relaxed text-graphite">
                {incident.error ?? "unknown failure"}
              </p>
            </div>
            <div className="text-right font-brand-mono text-[11px] leading-relaxed text-graphite">
              <div>{formatUtc(incident.started_at)}</div>
              <div className="opacity-70">
                {incident.ended_at ? formatUtc(incident.ended_at) : "—"}
              </div>
              <div className="opacity-70">{incident.failed_checks} failed checks</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
