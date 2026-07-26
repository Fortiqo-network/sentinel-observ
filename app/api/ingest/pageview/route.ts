import { NextResponse } from "next/server";
import { hasDatabase } from "@/lib/db";
import { ensureSchema } from "@/lib/schema";
import { recordPageview } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Pageview beacon from sentinel-frontend's edge middleware.
 *
 * Authenticated with a shared `X-Ingest-Token` rather than being open, so the
 * counter cannot be inflated by anyone who finds the URL. The token is safe to
 * hold because the caller is server-side middleware, never the browser.
 *
 * Nothing identifying is stored — no IP, no user agent, no cookie, no user id.
 * The requirement is raw visit volume, and keeping it to path/referrer/country
 * means this never becomes a personal-data store.
 *
 * Always answers 2xx. A beacon is fire-and-forget; failing it would put error
 * noise in the frontend's edge logs for a metric nobody is paged on.
 */
function referrerHost(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).host.slice(0, 255) || null;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json({ ok: false, reason: "ingest not configured" }, { status: 202 });
  }
  if (req.headers.get("x-ingest-token") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDatabase()) {
    return NextResponse.json({ ok: false, reason: "no database" }, { status: 202 });
  }

  try {
    const body = (await req.json()) as {
      path?: unknown;
      referrer?: unknown;
      country?: unknown;
    };
    const path = typeof body.path === "string" && body.path ? body.path : "/";

    await ensureSchema();
    await recordPageview({
      path,
      referrerHost: referrerHost(typeof body.referrer === "string" ? body.referrer : null),
      country: typeof body.country === "string" ? body.country.slice(0, 8) : null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: err instanceof Error ? err.message : String(err) },
      { status: 202 },
    );
  }
}
