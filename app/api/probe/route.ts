import { NextResponse } from "next/server";
import { probeAll } from "@/lib/probe";

export const dynamic = "force-dynamic";

export async function GET() {
  const results = await probeAll();
  return NextResponse.json({
    checked_at: new Date().toISOString(),
    up: results.filter((r) => r.ok).length,
    total: results.length,
    services: results,
  });
}
