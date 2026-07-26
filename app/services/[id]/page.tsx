import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getServiceDetail } from "@/lib/dashboard";
import { probeAll } from "@/lib/probe";
import { PageShell } from "@/components/layout/PageShell";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { StatusPill } from "@/components/ui/StatusDot";
import { IncidentList } from "@/components/dashboard/IncidentList";
import { UptimeBars } from "@/components/charts/UptimeBars";
import { LatencyChart } from "@/components/charts/LatencyChart";
import { SERVICES, serviceEndpoint } from "@/lib/services";
import {
  formatDuration,
  formatLatency,
  formatPercent,
  formatUtc,
  secondsBetween,
  uptimePercent,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const service = SERVICES.find((s) => s.id === id);
  return { title: service ? service.name : "Service" };
}

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const detail = await getServiceDetail(id);
  if (!detail) notFound();

  const { service, now } = detail;
  const live = (await probeAll()).find((r) => r.id === id) ?? null;
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const status = detail.state?.status ?? (live?.unknown ? "unknown" : live?.ok ? "up" : "down");
  const held = detail.state ? formatDuration(secondsBetween(detail.state.since, now)) : null;
  const uptime24h = detail.hasHistory
    ? uptimePercent(
        detail.incidents
          .filter((i) => (i.ended_at ?? now) > since24h)
          .reduce(
            (sum, i) =>
              sum +
              secondsBetween(
                i.started_at > since24h ? i.started_at : since24h,
                i.ended_at ?? now,
              ),
            0,
          ),
        24 * 60 * 60,
      )
    : null;

  return (
    <PageShell generatedAt={now}>
      <div>
        <Link
          href="/"
          className="font-brand-mono text-[11px] uppercase tracking-[0.14em] text-graphite hover:text-porcelain"
        >
          ← all services
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <h1 className="text-display-sm font-semibold tracking-tight text-porcelain">
            {service.name}
          </h1>
          <StatusPill status={status} />
          {held && (
            <span className="font-brand-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
              for {held}
            </span>
          )}
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-graphite">{service.summary}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Live probe"
          value={live?.ok ? `${live.status}` : live?.unknown ? "n/a" : "failed"}
          sub={formatLatency(live?.latencyMs ?? null)}
          tone={live?.ok ? "good" : live?.unknown ? "neutral" : "bad"}
        />
        <StatTile
          label="Uptime · 24 h"
          value={uptime24h === null ? "—" : formatPercent(uptime24h)}
          sub={`${detail.stats?.total_checks ?? 0} checks`}
        />
        <StatTile
          label="Uptime · 30 d"
          value={detail.uptime30d === null ? "—" : formatPercent(detail.uptime30d)}
          sub={`${detail.incidents.length} incidents recorded`}
        />
        <StatTile
          label="Response · 24 h"
          value={formatLatency(detail.stats?.avg_latency_ms ?? null)}
          sub={`p95 ${formatLatency(detail.stats?.p95_latency_ms ?? null)} · max ${formatLatency(detail.stats?.max_latency_ms ?? null)}`}
          tone="accent"
        />
      </div>

      {live?.error && (
        <div
          className={`panel border-status-down/40 bg-status-down/[0.06] p-5 ${live.unknown ? "border-porcelain/10 bg-porcelain/[0.03]" : ""}`}
        >
          <div className="eyebrow">Current failure</div>
          <p className="mt-1.5 font-brand-mono text-sm text-status-down">{live.error}</p>
          {!live.unknown && (
            <p className="mt-3 text-xs leading-relaxed text-graphite">
              <span className="text-porcelain/70">Impact:</span> {service.impact}
            </p>
          )}
        </div>
      )}

      <Panel eyebrow="Last 24 hours" title="Response time">
        <LatencyChart points={detail.latency} since={since24h} until={now} />
      </Panel>

      <Panel eyebrow="Last 90 days" title="Daily uptime">
        <UptimeBars points={detail.daily} days={90} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2" eyebrow="History" title="Incidents">
          <IncidentList
            incidents={detail.incidents}
            now={now}
            showService={false}
            emptyMessage={`${service.name} has no recorded outages.`}
          />
        </Panel>

        <Panel eyebrow="Runbook" title="How this is checked">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="eyebrow">Endpoint</dt>
              <dd className="mt-1 break-all font-brand-mono text-[11px] text-porcelain/80">
                {serviceEndpoint(service)}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Probe path</dt>
              <dd className="mt-1 text-xs text-graphite">
                {service.kind === "direct"
                  ? "Fetched directly from the public internet."
                  : "Read through the gateway's aggregate health endpoint (the service is on the private network)."}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Runs on</dt>
              <dd className="mt-1 text-xs text-graphite">
                {service.host === "vercel" ? "Vercel" : `Self-hosted runner box, port ${service.port}`}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Impact when down</dt>
              <dd className="mt-1 text-xs leading-relaxed text-graphite">{service.impact}</dd>
            </div>
            <div>
              <dt className="eyebrow">First command</dt>
              <dd className="mt-1 break-all rounded bg-ink-800 px-2 py-1.5 font-brand-mono text-[11px] text-gold">
                {service.debug}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel eyebrow="Raw" title="Recent checks" bodyClassName="px-0 py-0">
        {detail.checks.length === 0 ? (
          <p className="px-5 py-5 text-sm text-graphite">
            No recorded checks yet. The scheduled tick writes one row per service every five minutes.
          </p>
        ) : (
          <div className="max-h-[420px] overflow-auto scrollbar-thin">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="sticky top-0 bg-ink-900/95 backdrop-blur">
                <tr className="border-b border-porcelain/10 text-left">
                  {["Time (UTC)", "Result", "HTTP", "Latency", "Detail"].map((heading) => (
                    <th
                      key={heading}
                      className="px-5 py-2.5 font-brand-mono text-[10px] font-normal uppercase tracking-[0.14em] text-graphite"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-porcelain/[0.07]">
                {detail.checks.map((check, index) => (
                  <tr key={index} className="transition hover:bg-porcelain/[0.03]">
                    <td className="metric px-5 py-2.5 text-[11px] text-porcelain/70">
                      {formatUtc(check.checked_at)}
                    </td>
                    <td className="px-5 py-2.5">
                      <span
                        className={`font-brand-mono text-[11px] uppercase tracking-[0.12em] ${check.ok ? "text-status-up" : "text-status-down"}`}
                      >
                        {check.ok ? "ok" : "fail"}
                      </span>
                    </td>
                    <td className="metric px-5 py-2.5 text-[11px] text-porcelain/60">
                      {check.http_status ?? "—"}
                    </td>
                    <td className="metric px-5 py-2.5 text-[11px] text-porcelain/60">
                      {formatLatency(check.latency_ms)}
                    </td>
                    <td className="px-5 py-2.5 font-brand-mono text-[11px] text-graphite">
                      {check.error ?? "healthy"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
