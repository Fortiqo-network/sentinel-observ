import { SERVICES, type ServiceDef } from "./services";

export type CheckResult = {
  id: string;
  name: string;
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  error: string | null;
};

const DIRECT_TIMEOUT_MS = 10_000;
const AGGREGATE_TIMEOUT_MS = 20_000;

async function probeDirect(svc: ServiceDef): Promise<CheckResult> {
  const started = Date.now();
  try {
    const res = await fetch(svc.url!, {
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
      redirect: "follow",
      cache: "no-store",
    });
    return {
      id: svc.id,
      name: svc.name,
      ok: res.ok,
      status: res.status,
      latencyMs: Date.now() - started,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err: unknown) {
    return {
      id: svc.id,
      name: svc.name,
      ok: false,
      status: null,
      latencyMs: null,
      error: normalizeError(err),
    };
  }
}

/**
 * Probe the internal services through the gateway aggregate endpoint
 * (GET /internal/monitor/health — see docs/01-architecture.md).
 * Until that endpoint is deployed (Phase 2, step 2), aggregate services are
 * reported as "unknown" rather than down.
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
      error: "aggregate endpoint not configured (GATEWAY_URL/MONITOR_TOKEN unset)",
    }));
  }
  try {
    const res = await fetch(`${gatewayUrl}/internal/monitor/health`, {
      headers: { "X-Monitor-Token": token },
      signal: AbortSignal.timeout(AGGREGATE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`aggregate endpoint HTTP ${res.status}`);
    const data = await res.json();
    return services.map((svc) => {
      const r = data.services?.[svc.id];
      return {
        id: svc.id,
        name: svc.name,
        ok: Boolean(r?.ok),
        status: r?.status ?? null,
        latencyMs: r?.latency_ms ?? null,
        error: r ? (r.ok ? null : (r.error ?? `HTTP ${r.status}`)) : "missing from aggregate response",
      };
    });
  } catch (err: unknown) {
    // Gateway unreachable → all internal services unknown/down together.
    const reason = `gateway aggregate unreachable: ${normalizeError(err)}`;
    return services.map((svc) => ({
      id: svc.id,
      name: svc.name,
      ok: false,
      status: null,
      latencyMs: null,
      error: reason,
    }));
  }
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return "timeout";
    const cause = (err as Error & { cause?: { code?: string } }).cause;
    return cause?.code ?? err.message;
  }
  return String(err);
}

export async function probeAll(): Promise<CheckResult[]> {
  const direct = SERVICES.filter((s) => s.kind === "direct");
  const aggregate = SERVICES.filter((s) => s.kind === "aggregate");
  const [directResults, aggregateResults] = await Promise.all([
    Promise.all(direct.map(probeDirect)),
    probeAggregate(aggregate),
  ]);
  return [...directResults, ...aggregateResults];
}

export async function probePublicOnly(): Promise<CheckResult[]> {
  const direct = SERVICES.filter((s) => s.kind === "direct");
  return Promise.all(direct.map(probeDirect));
}
