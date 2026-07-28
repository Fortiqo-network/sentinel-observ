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
 */
async function handle(req: Request): Promise<NextResponse> {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const result = await runDailyReport();
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
