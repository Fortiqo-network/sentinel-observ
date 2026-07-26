import { SERVICES, type ServiceDef } from "./services";

/**
 * Probe engine (docs/04-monitoring-spec.md).
 *
 * Two probe paths: public services are fetched directly, and the five internal
 * services are read in one call to the gateway's aggregate endpoint (they sit
 * on a private Docker network that an off-site monitor cannot reach).
 *
 * A failing probe is retried twice more inside the same run before it counts as
 * DOWN. That kills one-off network blips without waiting for the next 5-minute
 * tick, so worst-case detection stays under ~6 minutes.
 */

export type CheckResult = {
  id: string;
  name: string;
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  error: string | null;
  /** Number of probe attempts spent on this service in this run. */
  attempts: number;
  /**
   * True when the result is not evidence either way — the aggregate endpoint is
   * not configured yet. Unknown results are recorded but never alert.
   */
  unknown: boolean;
};

const DIRECT_TIMEOUT_MS = 8_000;
const AGGREGATE_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 3_000;
const MAX_ATTEMPTS = 3;
const BODY_SNIPPET_MAX = 200;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Collapse a fetch rejection into a short, stable, human-readable reason. */
export function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "timeout";
    const code = (err as Error & { cause?: { code?: string } }).cause?.code;
    switch (code) {
      case "ECONNREFUSED":
        return "connection refused";
      case "ENOTFOUND":
      case "EAI_AGAIN":
        return "DNS lookup failed";
      case "ECONNRESET":
        return "connection reset";
      case "CERT_HAS_EXPIRED":
        return "TLS certificate expired";
      case "UND_ERR_CONNECT_TIMEOUT":
        return "timeout";
      default:
        return code ?? err.message;
    }
  }
  return String(err);
}

/**
 * Expand a raw failure into the sentence that appears in the Slack alert.
 * Doc 04 lists the exact wording per failure class.
 */
export function describeFailure(params: {
  reason: string;
  status: number | null;
  attempts: number;
  path: string;
  bodySnippet?: string | null;
  timeoutMs?: number;
}): string {
  const { reason, status, attempts, path } = params;
  const tries = attempts > 1 ? ` ×${attempts} attempts` : "";

  if (status !== null && status >= 500) {
    const snippet = params.bodySnippet ? ` — ${params.bodySnippet}` : "";
    return `HTTP ${status} from ${path} — up but unhealthy${tries}${snippet}`;
  }
  if (status !== null && status >= 400) {
    return `HTTP ${status} from ${path} — health route missing or changed (deploy issue?)${tries}`;
  }
  if (reason === "timeout") {
    const seconds = Math.round((params.timeoutMs ?? DIRECT_TIMEOUT_MS) / 1000);
    return `no response within ${seconds}s${tries} — hung or overloaded`;
  }
  return `${reason}${tries} — process or host is down`;
}

type Attempt = {
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  reason: string | null;
  bodySnippet: string | null;
};

async function attemptDirect(url: string): Promise<Attempt> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
      redirect: "follow",
      cache: "no-store",
      headers: { "user-agent": "sentinel-observ/1.0 (+uptime monitor)" },
    });
    const latencyMs = Date.now() - started;
    if (res.ok || (res.status >= 300 && res.status < 400)) {
      return { ok: true, status: res.status, latencyMs, reason: null, bodySnippet: null };
    }
    let bodySnippet: string | null = null;
    try {
      bodySnippet = (await res.text()).slice(0, BODY_SNIPPET_MAX).replace(/\s+/g, " ").trim() || null;
    } catch {
      bodySnippet = null;
    }
    return { ok: false, status: res.status, latencyMs, reason: `HTTP ${res.status}`, bodySnippet };
  } catch (err) {
    return {
      ok: false,
      status: null,
      latencyMs: null,
      reason: normalizeError(err),
      bodySnippet: null,
    };
  }
}

/** Probe one public service, retrying in-run before declaring it down. */
async function probeDirect(svc: ServiceDef): Promise<CheckResult> {
  let attempt: Attempt = { ok: false, status: null, latencyMs: null, reason: "not run", bodySnippet: null };
  let attempts = 0;

  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    attempts += 1;
    attempt = await attemptDirect(svc.url!);
    if (attempt.ok) break;
    if (i < MAX_ATTEMPTS - 1) await sleep(RETRY_DELAY_MS);
  }

  const path = new URL(svc.url!).pathname || "/";
  return {
    id: svc.id,
    name: svc.name,
    ok: attempt.ok,
    status: attempt.status,
    latencyMs: attempt.latencyMs,
    attempts,
    unknown: false,
    error: attempt.ok
      ? null
      : describeFailure({
          reason: attempt.reason ?? "unknown error",
          status: attempt.status,
          attempts,
          path,
          bodySnippet: attempt.bodySnippet,
          timeoutMs: DIRECT_TIMEOUT_MS,
        }),
  };
}

type AggregateEntry = { ok?: boolean; status?: number | null; latency_ms?: number | null; error?: string | null };

/**
 * Read every internal service in one call to
 * `GET {GATEWAY_URL}/internal/monitor/health`.
 *
 * Failure semantics are deliberate: if the gateway itself is unreachable the
 * whole backend is unreachable for users too, so every internal service is
 * reported down with that reason — the storm suppressor then collapses it into
 * a single "platform outage" alert.
 */
async function probeAggregate(services: ServiceDef[]): Promise<CheckResult[]> {
  const gatewayUrl = process.env.GATEWAY_URL;
  const token = process.env.MONITOR_TOKEN;

  if (!gatewayUrl || !token) {
    return services.map((svc) => ({
      id: svc.id,
      name: svc.name,
      ok: false,
      status: null,
      latencyMs: null,
      attempts: 0,
      unknown: true,
      error: "aggregate endpoint not configured (set GATEWAY_URL and MONITOR_TOKEN)",
    }));
  }

  let lastReason = "unknown error";
  let misconfigured = false;
  let attempts = 0;

  for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
    attempts += 1;
    try {
      const res = await fetch(`${gatewayUrl.replace(/\/$/, "")}/internal/monitor/health`, {
        headers: { "X-Monitor-Token": token },
        signal: AbortSignal.timeout(AGGREGATE_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) {
        // 401/403 = our token is wrong; 503 = the gateway has MONITOR_TOKEN unset.
        // Both mean the monitor cannot see these services — which is NOT the same
        // as the services being down, and must never page anyone. Retrying cannot
        // help either, so stop immediately.
        if (res.status === 401 || res.status === 403 || res.status === 503) {
          misconfigured = true;
          lastReason =
            res.status === 503
              ? "the gateway has MONITOR_TOKEN unset, so its monitor endpoint is disabled"
              : "the gateway rejected MONITOR_TOKEN — the two values do not match";
          break;
        }
        lastReason = `aggregate endpoint returned HTTP ${res.status}`;
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      const data = (await res.json()) as { services?: Record<string, AggregateEntry> };
      return services.map((svc) => {
        const entry = data.services?.[svc.id];
        if (!entry) {
          return {
            id: svc.id,
            name: svc.name,
            ok: false,
            status: null,
            latencyMs: null,
            attempts,
            unknown: true,
            error: "missing from the gateway aggregate response",
          };
        }
        const ok = Boolean(entry.ok);
        return {
          id: svc.id,
          name: svc.name,
          ok,
          status: entry.status ?? null,
          latencyMs: entry.latency_ms ?? null,
          attempts,
          unknown: false,
          error: ok
            ? null
            : describeFailure({
                reason: entry.error ?? "unhealthy",
                status: entry.status ?? null,
                attempts,
                path: svc.internal ? new URL(svc.internal).pathname : "/health",
                timeoutMs: AGGREGATE_TIMEOUT_MS,
              }),
        };
      });
    } catch (err) {
      lastReason = normalizeError(err);
      if (i < MAX_ATTEMPTS - 2) await sleep(RETRY_DELAY_MS);
    }
  }

  const reason = misconfigured
    ? `not monitored — ${lastReason}`
    : `gateway unreachable (${lastReason}) — the entire backend stack may be offline`;

  return services.map((svc) => ({
    id: svc.id,
    name: svc.name,
    ok: false,
    status: null,
    latencyMs: null,
    attempts,
    unknown: misconfigured,
    error: reason,
  }));
}

/** Probe every monitored service, in inventory order. */
export async function probeAll(): Promise<CheckResult[]> {
  const direct = SERVICES.filter((s) => s.kind === "direct");
  const aggregate = SERVICES.filter((s) => s.kind === "aggregate");
  const [directResults, aggregateResults] = await Promise.all([
    Promise.all(direct.map(probeDirect)),
    probeAggregate(aggregate),
  ]);
  const byId = new Map([...directResults, ...aggregateResults].map((r) => [r.id, r]));
  return SERVICES.map((s) => byId.get(s.id)!).filter(Boolean);
}

/** Probe only the publicly reachable services (no gateway token required). */
export async function probePublicOnly(): Promise<CheckResult[]> {
  return Promise.all(SERVICES.filter((s) => s.kind === "direct").map(probeDirect));
}
