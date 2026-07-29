import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { runWeeklyReport } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Weekly summary job — the trailing 7 days plus a per-service trend against the
 * 7 days before that, MTTR, and the week's longest incident. Also run by the
 * health tick when overdue.
 */
async function handle(req: Request): Promise<NextResponse> {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const force = new URL(req.url).searchParams.get("force") === "1";
  const result = await runWeeklyReport(new Date(), { force });
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
