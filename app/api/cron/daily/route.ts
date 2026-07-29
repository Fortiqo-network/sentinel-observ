import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { runDailyReport } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily summary job.
 *
 * Reports on the trailing 24 hours (not a calendar day) so the numbers are
 * complete regardless of what hour the schedule fires in. The health tick also
 * runs this when it is overdue, so a dropped schedule delays the report rather
 * than losing it.
 *
 * Calling this is a *request*, not a command: it is a no-op if the day's report
 * already exists. GitHub schedules routinely fire hours late, and a late call
 * landing after the tick already produced the report would otherwise post a
 * second one for the same day. `?force=1` bypasses the claim, for testing.
 */
async function handle(req: Request): Promise<NextResponse> {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const force = new URL(req.url).searchParams.get("force") === "1";
  const result = await runDailyReport(new Date(), { force });
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
