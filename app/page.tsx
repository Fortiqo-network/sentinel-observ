import Link from "next/link";
import { getDashboard } from "@/lib/dashboard";
import { PageShell } from "@/components/layout/PageShell";
import { StatusHero } from "@/components/dashboard/StatusHero";
import { ConfigChecklist } from "@/components/dashboard/ConfigChecklist";
import { ServiceCard } from "@/components/dashboard/ServiceCard";
import { IncidentList } from "@/components/dashboard/IncidentList";
import { MonitorHealthPanel } from "@/components/dashboard/MonitorHealthPanel";
import { StoragePanel } from "@/components/dashboard/StoragePanel";
import { MoneyPathPanel } from "@/components/dashboard/MoneyPathPanel";
import { LatencyChart } from "@/components/charts/LatencyChart";
import { UptimeBars } from "@/components/charts/UptimeBars";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { StatusDot } from "@/components/ui/StatusDot";
import { formatDuration, formatLatency, formatPercent } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OverviewPage(): Promise<React.JSX.Element> {
  const data = await getDashboard();
  const since24h = new Date(data.generatedAt.getTime() - 24 * 60 * 60 * 1000);
  const slowest = [...data.cards]
    .filter((c) => c.p95LatencyMs !== null)
    .sort((a, b) => (b.p95LatencyMs ?? 0) - (a.p95LatencyMs ?? 0))[0];

  return (
    <PageShell generatedAt={data.generatedAt}>
      <StatusHero data={data} />
      <ConfigChecklist config={data.config} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Services up"
          value={`${data.overall.up}/${data.overall.total - data.overall.unknown}`}
          sub={data.overall.unknown > 0 ? `${data.overall.unknown} not monitored` : "all monitored"}
          tone={data.overall.up === data.overall.total - data.overall.unknown ? "good" : "bad"}
        />
        <StatTile
          label="Open incidents"
          value={data.overall.openIncidents}
          sub={`${data.overall.incidents30d} in the last 30 days`}
          tone={data.overall.openIncidents > 0 ? "bad" : "neutral"}
        />
        <StatTile
          label="Avg response · 24 h"
          value={formatLatency(data.overall.avgLatencyMs)}
          sub={
            slowest
              ? `slowest: ${slowest.service.name} p95 ${formatLatency(slowest.p95LatencyMs)}`
              : "awaiting samples"
          }
        />
        <StatTile
          label="Checks recorded · 24 h"
          value={data.overall.totalChecks24h.toLocaleString("en-US")}
          sub={`${data.monitor.ticks24h}/${data.monitor.ticksExpected} scheduled ticks`}
          tone="accent"
        />
      </div>

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight text-porcelain">Services</h2>
          <span className="font-brand-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
            live probe on load
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.cards.map((card) => (
            <ServiceCard key={card.service.id} card={card} latency={data.latency} now={data.generatedAt} />
          ))}
        </div>
      </div>

      <Panel
        eyebrow="Last 24 hours"
        title="Response time"
        action={
          <span className="font-brand-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
            15-minute buckets
          </span>
        }
      >
        <LatencyChart points={data.latency} since={since24h} until={data.generatedAt} />
      </Panel>

      <Panel
        eyebrow="Last 90 days"
        title="Daily uptime"
        action={
          <div className="flex items-center gap-3 font-brand-mono text-[10px] uppercase tracking-[0.12em] text-graphite">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-status-up/80" /> up
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-status-degraded/85" /> partial
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-status-down/90" /> outage
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-porcelain/[0.07]" /> no data
            </span>
          </div>
        }
      >
        <div className="space-y-5">
          {data.cards.map((card) => (
            <div key={card.service.id}>
              <div className="mb-1.5 flex items-baseline justify-between gap-4">
                <span className="flex items-center gap-2 text-sm text-porcelain">
                  <StatusDot status={card.status} />
                  {card.service.name}
                </span>
                <span className="metric text-xs text-graphite">
                  {card.uptime30d === null ? "—" : `${formatPercent(card.uptime30d)} · 30 d`}
                  {card.downtime30dSecs > 0 && ` · ${formatDuration(card.downtime30dSecs)} down`}
                </span>
              </div>
              <UptimeBars
                points={data.daily.filter((d) => d.service_id === card.service.id)}
                days={90}
                height="h-6"
              />
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          eyebrow="History"
          title="Recent incidents"
          action={
            <Link
              href="/incidents"
              className="font-brand-mono text-[11px] uppercase tracking-[0.14em] text-gold hover:underline"
            >
              view all
            </Link>
          }
        >
          <IncidentList incidents={data.incidents.slice(0, 8)} now={data.generatedAt} />
        </Panel>

        <div className="space-y-6">
          <MoneyPathPanel snapshot={data.money} now={data.generatedAt} />
          <MonitorHealthPanel monitor={data.monitor} now={data.generatedAt} />
          {data.storage && <StoragePanel usage={data.storage} />}
        </div>
      </div>

      <Panel eyebrow="Detail" title="Per-service metrics" bodyClassName="px-0 py-0">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-porcelain/10 text-left">
                {[
                  "Service",
                  "State",
                  "Uptime 24 h",
                  "Uptime 30 d",
                  "Avg",
                  "p95",
                  "Max",
                  "Checks 24 h",
                  "Failed",
                ].map((heading) => (
                  <th
                    key={heading}
                    className="px-5 py-3 font-brand-mono text-[10px] font-normal uppercase tracking-[0.14em] text-graphite"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-porcelain/[0.07]">
              {data.cards.map((card) => (
                <tr key={card.service.id} className="transition hover:bg-porcelain/[0.03]">
                  <td className="px-5 py-3">
                    <Link
                      href={`/services/${card.service.id}`}
                      className="font-medium text-porcelain hover:text-gold"
                    >
                      {card.service.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <StatusDot status={card.status} />
                  </td>
                  <td className="metric px-5 py-3 text-porcelain/80">
                    {card.uptime24h === null ? "—" : formatPercent(card.uptime24h)}
                  </td>
                  <td className="metric px-5 py-3 text-porcelain/80">
                    {card.uptime30d === null ? "—" : formatPercent(card.uptime30d)}
                  </td>
                  <td className="metric px-5 py-3 text-porcelain/60">
                    {formatLatency(card.avgLatencyMs)}
                  </td>
                  <td className="metric px-5 py-3 text-porcelain/60">
                    {formatLatency(card.p95LatencyMs)}
                  </td>
                  <td className="metric px-5 py-3 text-porcelain/60">
                    {formatLatency(card.maxLatencyMs)}
                  </td>
                  <td className="metric px-5 py-3 text-porcelain/60">{card.checks24h}</td>
                  <td
                    className={`metric px-5 py-3 ${card.failed24h > 0 ? "text-status-down" : "text-porcelain/60"}`}
                  >
                    {card.failed24h}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </PageShell>
  );
}
