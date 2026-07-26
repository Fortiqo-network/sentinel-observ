import { NextResponse } from "next/server";
import { probeAll } from "@/lib/probe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 5-minute monitoring tick, called by the GitHub Actions scheduler
 * (see docs/01-architecture.md). Phase 2 adds: DB persistence, the alert
 * state machine and Slack notifications (docs/04-monitoring-spec.md).
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results = await probeAll();
  return NextResponse.json({
    checked_at: new Date().toISOString(),
    up: results.filter((r) => r.ok).length,
    total: results.length,
    services: results,
    persisted: false, // Phase 2
    alerted: false, // Phase 2
  });
}
