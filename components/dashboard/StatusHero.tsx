import type { DashboardData } from "@/lib/dashboard";
import { formatPercent, formatUtc } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

/**
 * The one-line answer the page exists to give: is Sentinel up right now.
 *
 * A partially-configured monitor says so explicitly rather than claiming
 * "all systems operational" for services it cannot actually see.
 */
export function StatusHero({ data }: { data: DashboardData }): React.JSX.Element {
  const monitored = data.overall.total - data.overall.unknown;
  const allUp = monitored > 0 && data.overall.up === monitored;
  const anyDown = data.cards.some((c) => c.status === "down");

  const headline = anyDown
    ? `${data.cards.filter((c) => c.status === "down").length} service${data.cards.filter((c) => c.status === "down").length === 1 ? "" : "s"} down`
    : allUp
      ? "All systems operational"
      : "Awaiting first checks";

  const tone = anyDown ? "bad" : allUp ? "good" : "muted";

  return (
    <section className="relative overflow-hidden rounded-2xl border border-porcelain/10 bg-ink-900/60 p-6 sm:p-8 grain">
      <div aria-hidden className="pointer-events-none absolute inset-0 aurora-wash" />
      <div className="relative">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 font-brand-mono text-[11px] uppercase tracking-[0.16em]",
              tone === "bad" && "border-status-down/40 bg-status-down/10 text-status-down",
              tone === "good" && "border-status-up/40 bg-status-up/10 text-status-up",
              tone === "muted" && "border-porcelain/15 bg-porcelain/5 text-graphite",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                tone === "bad" ? "bg-status-down" : tone === "good" ? "bg-status-up" : "bg-graphite",
              )}
            />
            {data.overall.up}/{monitored || data.overall.total} services up
          </span>
          {data.overall.unknown > 0 && (
            <span className="font-brand-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
              {data.overall.unknown} not monitored yet
            </span>
          )}
          {data.overall.openIncidents > 0 && (
            <span className="font-brand-mono text-[11px] uppercase tracking-[0.14em] text-status-down">
              {data.overall.openIncidents} open incident
              {data.overall.openIncidents === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <h1 className="mt-4 text-display-sm font-semibold tracking-tight text-porcelain">
          {headline}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-graphite">
          Continuous health probing of every Sentinel service, every five minutes, from outside the
          network. Failures alert to Slack in realtime; uptime is measured from incident spans, not
          from check counts.
        </p>

        <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <dt className="eyebrow">Uptime · 24 h</dt>
            <dd className="metric mt-1 text-2xl font-semibold text-porcelain">
              {data.overall.uptime24h === null ? "—" : formatPercent(data.overall.uptime24h)}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Uptime · 30 d</dt>
            <dd className="metric mt-1 text-2xl font-semibold text-porcelain">
              {data.overall.uptime30d === null ? "—" : formatPercent(data.overall.uptime30d)}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Incidents · 30 d</dt>
            <dd className="metric mt-1 text-2xl font-semibold text-porcelain">
              {data.overall.incidents30d}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Last probed</dt>
            <dd className="metric mt-1 text-2xl font-semibold text-porcelain">
              {formatUtc(data.generatedAt).slice(11)}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
