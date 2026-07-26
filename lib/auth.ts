import { NextResponse } from "next/server";

/**
 * Shared guard for the `/api/cron/*` routes.
 *
 * The scheduler presents `Authorization: Bearer $CRON_SECRET`. Without this,
 * anyone could trigger probe storms, spam the alarm channel, or force
 * duplicate reports. Fails closed: an unset `CRON_SECRET` rejects everything
 * rather than opening the routes up.
 */
export function requireCronSecret(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on this deployment" },
      { status: 503 },
    );
  }

  const header = req.headers.get("authorization");
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!presented || !timingSafeEqual(presented, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/** Constant-time string compare, so a wrong secret leaks no length or prefix. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
