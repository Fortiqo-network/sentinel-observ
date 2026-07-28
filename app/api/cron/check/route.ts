import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { runCheckTick } from "@/lib/tick";
import { runDueReports } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The 5-minute monitoring tick, called by the GitHub Actions scheduler
 * (docs/01-architecture.md). Probes every service, persists the results, runs
 * the alert state machine, and posts to Slack on transitions.
 *
 * GET and POST behave identically so the endpoint can be exercised with a
 * plain browser-less curl during setup.
 */
async function handle(req: Request): Promise<NextResponse> {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    const summary = await runCheckTick();
    // Reports piggyback on the tick so they survive a scheduler that drops
    // most of its runs. Never allowed to fail the tick itself.
    const reports = await runDueReports();
    return NextResponse.json(
      Object.keys(reports).length ? { ...summary, reports } : summary,
    );
  } catch (err) {
    return NextResponse.json(
      { error: "tick failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
