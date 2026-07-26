import type { Metadata } from "next";
import { hasDatabase } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { listIncidents } from "@/lib/repo";
import { PageShell } from "@/components/layout/PageShell";
import { IncidentList } from "@/components/dashboard/IncidentList";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { formatDuration, secondsBetween } from "@/lib/format";
import { serviceName } from "@/lib/services";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Incidents" };

export default async function IncidentsPage(): Promise<React.JSX.Element> {
  const now = new Date();

  if (!hasDatabase()) {
    return (
      <PageShell generatedAt={now}>
        <Panel eyebrow="History" title="Incidents">
          <p className="text-sm text-graphite">
            Incident history needs a database. Set <code className="text-gold">DATABASE_URL</code> in
            the Vercel project and redeploy — every check, incident and rollup is recorded from that
            point on.
          </p>
        </Panel>
      </PageShell>
    );
  }

  await ensureSchema();
  const incidents = await listIncidents({ limit: 200 });

  const resolved = incidents.filter((i) => i.ended_at !== null);
  const open = incidents.filter((i) => i.ended_at === null);
  const mttrSecs = resolved.length
    ? resolved.reduce((sum, i) => sum + secondsBetween(i.started_at, i.ended_at!), 0) /
      resolved.length
    : null;
  const longest = resolved.reduce<(typeof resolved)[number] | null>((best, i) => {
    if (!best) return i;
    return secondsBetween(i.started_at, i.ended_at!) > secondsBetween(best.started_at, best.ended_at!)
      ? i
      : best;
  }, null);

  const byService = new Map<string, number>();
  for (const incident of incidents) {
    byService.set(incident.service_id, (byService.get(incident.service_id) ?? 0) + 1);
  }
  const worst = [...byService.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <PageShell generatedAt={now}>
      <div>
        <h1 className="text-display-sm font-semibold tracking-tight text-porcelain">Incidents</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-graphite">
          Every outage the monitor has observed, newest first. An incident opens when three
          consecutive probes fail and closes on the first successful probe after that.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Open now"
          value={open.length}
          tone={open.length > 0 ? "bad" : "good"}
          sub={open.length ? open.map((i) => serviceName(i.service_id)).join(", ") : "nothing down"}
        />
        <StatTile label="Recorded total" value={incidents.length} sub="all time" />
        <StatTile
          label="Mean time to recovery"
          value={mttrSecs === null ? "—" : formatDuration(mttrSecs)}
          sub={`${resolved.length} resolved`}
        />
        <StatTile
          label="Most affected"
          value={worst ? serviceName(worst[0]) : "—"}
          sub={worst ? `${worst[1]} incidents` : "no incidents yet"}
          tone="accent"
        />
      </div>

      {longest?.ended_at && (
        <Panel eyebrow="Worst outage" title={serviceName(longest.service_id)}>
          <p className="text-sm text-porcelain">
            {formatDuration(secondsBetween(longest.started_at, longest.ended_at))} of downtime
            starting {longest.started_at.toISOString().replace("T", " ").slice(0, 16)} UTC.
          </p>
          <p className="mt-1 font-brand-mono text-[11px] text-graphite">
            {longest.error ?? "unknown failure"}
          </p>
        </Panel>
      )}

      <Panel eyebrow="Log" title={`${incidents.length} incidents`}>
        <IncidentList incidents={incidents} now={now} />
      </Panel>
    </PageShell>
  );
}
