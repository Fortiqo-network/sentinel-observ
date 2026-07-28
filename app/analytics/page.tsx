import type { Metadata } from "next";
import { hasDatabase } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import {
  getTrafficBreakdown,
  getTrafficByDay,
  getTrafficByHour,
  getTrafficTotals,
} from "@/lib/repo";
import { PageShell } from "@/components/layout/PageShell";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { BreakdownBars, TrafficChart } from "@/components/charts/TrafficChart";
import { HoverBars } from "@/components/charts/HoverBars";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Traffic",
  robots: { index: false, follow: false },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Visit counts for sentinel.fortiqo.xyz, reported by its edge middleware. */
export default async function AnalyticsPage(): Promise<React.JSX.Element> {
  const now = new Date();

  if (!hasDatabase()) {
    return (
      <PageShell generatedAt={now}>
        <Panel eyebrow="Traffic" title="Frontend visits">
          <p className="text-sm text-graphite">
            Traffic history needs a database. Set{" "}
            <code className="text-gold">DATABASE_URL</code> and redeploy.
          </p>
        </Panel>
      </PageShell>
    );
  }

  await ensureSchema();
  const [totals, byHour, byDay, paths, referrers, countries] = await Promise.all([
    getTrafficTotals(),
    getTrafficByHour(),
    getTrafficByDay(30),
    getTrafficBreakdown("path", 30, 10),
    getTrafficBreakdown("referrer_host", 30, 8),
    getTrafficBreakdown("country", 30, 8),
  ]);

  const dayMap = new Map(byDay.map((d) => [d.day, d.views]));
  const days = Array.from({ length: 30 }, (_, i) => {
    const at = new Date(now.getTime() - (29 - i) * DAY_MS);
    const key = at.toISOString().slice(0, 10);
    return { day: key, views: dayMap.get(key) ?? 0 };
  });
  const peakDay = Math.max(1, ...days.map((d) => d.views));
  const dailyAverage = Math.round(totals.last_30d / 30);

  return (
    <PageShell generatedAt={now}>
      <div>
        <h1 className="text-display-sm font-semibold tracking-tight text-porcelain">Traffic</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-graphite">
          Every visit to sentinel.fortiqo.xyz, counted server-side at the edge — so ad-blockers and
          disabled JavaScript do not undercount it. Raw visits, not unique visitors: no cookie, no
          IP and no user agent is stored.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Last hour" value={totals.last_hour.toLocaleString("en-US")} tone="accent" />
        <StatTile label="Last 24 h" value={totals.last_24h.toLocaleString("en-US")} />
        <StatTile label="Last 7 days" value={totals.last_7d.toLocaleString("en-US")} />
        <StatTile
          label="Last 30 days"
          value={totals.last_30d.toLocaleString("en-US")}
          sub={`${dailyAverage.toLocaleString("en-US")} / day average`}
        />
        <StatTile label="All time" value={totals.all_time.toLocaleString("en-US")} />
      </div>

      <Panel eyebrow="Last 24 hours" title="Visits per hour">
        <TrafficChart buckets={byHour} now={now} />
      </Panel>

      <Panel
        eyebrow="Last 30 days"
        title="Visits per day"
        action={
          <span className="font-brand-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
            peak {peakDay.toLocaleString("en-US")}
          </span>
        }
      >
        <HoverBars
          heightClass="h-[160px]"
          bars={days.map((day) => ({
            key: day.day,
            fraction: day.views / peakDay,
            className: "bg-sentinel-400/60",
            label: day.day,
            value: `${day.views.toLocaleString("en-US")} ${day.views === 1 ? "visit" : "visits"}`,
          }))}
        />
        <div className="mt-2 flex items-center justify-between font-brand-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
          <span>{days[0].day}</span>
          <span>today</span>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel eyebrow="Last 30 days" title="Top pages">
          <BreakdownBars rows={paths} emptyMessage="No visits recorded yet." />
        </Panel>
        <Panel eyebrow="Last 30 days" title="Referrers">
          <BreakdownBars
            rows={referrers}
            emptyMessage="No referrers yet — all traffic has been direct."
          />
        </Panel>
        <Panel eyebrow="Last 30 days" title="Countries">
          <BreakdownBars rows={countries} emptyMessage="No country data yet." />
        </Panel>
      </div>
    </PageShell>
  );
}
