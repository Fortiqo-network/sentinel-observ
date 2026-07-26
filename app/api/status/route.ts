import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Machine-readable snapshot of everything the dashboard shows. Public and
 * read-only — it exposes uptime, latency and incident metadata, never secrets
 * or upstream response bodies.
 */
export async function GET() {
  const data = await getDashboard();
  return NextResponse.json(
    {
      generated_at: data.generatedAt.toISOString(),
      status: data.overall.up === data.overall.total - data.overall.unknown ? "operational" : "degraded",
      overall: data.overall,
      config: data.config,
      services: data.cards.map((card) => ({
        id: card.service.id,
        name: card.service.name,
        status: card.status,
        since: card.since?.toISOString() ?? null,
        uptime_24h: card.uptime24h,
        uptime_7d: card.uptime7d,
        uptime_30d: card.uptime30d,
        latency_ms: card.live?.latencyMs ?? null,
        avg_latency_ms: card.avgLatencyMs,
        p95_latency_ms: card.p95LatencyMs,
        error: card.lastError,
      })),
      open_incidents: data.incidents
        .filter((i) => i.ended_at === null)
        .map((i) => ({
          id: i.id,
          service_id: i.service_id,
          started_at: i.started_at.toISOString(),
          error: i.error,
        })),
      monitor: {
        ticks_24h: data.monitor.ticks24h,
        ticks_expected: data.monitor.ticksExpected,
        last_run_at: data.monitor.lastRunAt?.toISOString() ?? null,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
