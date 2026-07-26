import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isAuthConfigured, verifySessionToken } from "@/lib/password";

/**
 * Access gate for the dashboard.
 *
 * The monitoring UI is private: everything under `/` requires a session cookie
 * minted by `/api/auth/login`. Machine endpoints are deliberately exempt because
 * they carry their own, stronger authentication and are called by systems that
 * cannot complete a login form:
 *
 *   - `/api/cron/*`     — the GitHub Actions scheduler (`CRON_SECRET`)
 *   - `/api/slack/*`    — the credential smoke test (`CRON_SECRET`)
 *   - `/api/ingest/*`   — pageview beacons from sentinel-frontend (`INGEST_TOKEN`)
 *
 * Putting a login wall in front of those would silently stop the monitor.
 *
 * Fails closed: with `DASHBOARD_PASSWORD_HASH` unset, no password can ever
 * match, so the login page reports that it is unconfigured rather than letting
 * anyone through.
 */

const EXEMPT_PREFIXES = ["/api/cron", "/api/slack", "/api/ingest", "/login", "/api/auth"];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const authorized = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (authorized) return NextResponse.next();

  // An unauthenticated API call gets JSON, not an HTML redirect a client would
  // have to parse to discover it was logged out.
  if (pathname.startsWith("/api")) {
    return NextResponse.json(
      { error: "unauthorized", configured: isAuthConfigured() },
      { status: 401 },
    );
  }

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login, 307);
}

/**
 * Match every page and API route except Next's build output, the favicon and
 * the brand assets — those must stay reachable so the login page can render.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
