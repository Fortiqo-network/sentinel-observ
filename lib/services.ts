/**
 * Service inventory — the single source of truth for what is monitored.
 *
 * Probe logic, alert copy and the dashboard all read from this list; nothing
 * about a service is hardcoded anywhere else. `impact` and `debug` are what
 * make a Slack alert actionable rather than generic ("Billing is down" vs
 * "payments are unavailable, run `docker logs sentinel-billing`").
 *
 * See docs/02-service-inventory.md for why the health paths differ per service.
 */

export type ServiceKind = "direct" | "aggregate";

export type ServiceDef = {
  id: string;
  name: string;
  kind: ServiceKind;
  /** Public URL probed directly (kind: direct). */
  url?: string;
  /** URL the gateway aggregate endpoint calls from inside sentinel-net (kind: aggregate). */
  internal?: string;
  /** Container port, for alert copy and the dashboard's service card. */
  port: number;
  /** Where the service runs — drives the "this is the box, not the app" reasoning. */
  host: "server" | "vercel";
  /** One line on what the service does. */
  summary: string;
  /** What users lose while it is down. Goes into the Slack alert. */
  impact: string;
  /** First command an operator should run. Goes into the Slack alert. */
  debug: string;
};

export const SERVICES: ServiceDef[] = [
  {
    id: "gateway",
    name: "Gateway",
    kind: "direct",
    url: "https://sentinel-api.fortiqo.xyz/health",
    port: 8080,
    host: "server",
    summary: "The only internet-facing service — auth, rate limits, metering, routing.",
    impact: "All API traffic is down — the entire platform is unreachable for users.",
    debug: "docker logs sentinel-gateway --tail 100",
  },
  {
    id: "frontend",
    name: "Frontend",
    kind: "direct",
    url: "https://sentinel.fortiqo.xyz/",
    port: 3000,
    host: "vercel",
    summary: "Web console and marketplace UI, deployed on Vercel.",
    impact: "Web console and marketplace UI unavailable; APIs may still work.",
    debug: "Check the Vercel deployment dashboard for sentinel-frontend",
  },
  {
    id: "core-api",
    name: "Core API",
    kind: "aggregate",
    internal: "http://sentinel-core-api:8000/v1/health",
    port: 8000,
    host: "server",
    summary: "Identity, agent lifecycle, marketplace state, entitlements.",
    impact: "Identity, agent lifecycle and marketplace state unavailable.",
    debug: "docker logs sentinel-core-api --tail 100",
  },
  {
    id: "verify",
    name: "Verify",
    kind: "aggregate",
    internal: "http://sentinel-verify:8001/api/v1/health",
    port: 8001,
    host: "server",
    summary: "Agent verification pipeline and trust scoring.",
    impact: "Verification pipeline and trust scoring halted.",
    debug: "docker logs sentinel-verify --tail 100",
  },
  {
    id: "billing",
    name: "Billing",
    kind: "aggregate",
    internal: "http://sentinel-billing:8002/v1/health",
    port: 8002,
    host: "server",
    summary: "Wallets, credits ledger, per-call settlement.",
    impact: "Payments, wallets and settlement unavailable.",
    debug: "docker logs sentinel-billing --tail 100",
  },
  {
    id: "registry",
    name: "Registry",
    kind: "aggregate",
    internal: "http://sentinel-registry:8003/v1/health",
    port: 8003,
    host: "server",
    summary: "Agent manifests and tool-schema resolution.",
    impact: "Agent artifact publishing and resolution unavailable.",
    debug: "docker logs sentinel-registry --tail 100",
  },
  {
    id: "runtime",
    name: "Runtime",
    kind: "aggregate",
    internal: "http://sentinel-runtime:8004/v1/health",
    port: 8004,
    host: "server",
    summary: "Managed (Tier A) agent execution — stub at MVP.",
    impact: "Managed agent execution unavailable (stub service).",
    debug: "docker logs sentinel-runtime --tail 100",
  },
];

export const SERVICE_IDS: string[] = SERVICES.map((s) => s.id);

/** Look up a service definition by id. Returns undefined for unknown ids. */
export function getService(id: string): ServiceDef | undefined {
  return SERVICES.find((s) => s.id === id);
}

/** Human label for a service id, falling back to the raw id. */
export function serviceName(id: string): string {
  return getService(id)?.name ?? id;
}

/** Where the probe reaches a service, as shown on the dashboard. */
export function serviceEndpoint(svc: ServiceDef): string {
  return svc.kind === "direct" ? (svc.url ?? "") : (svc.internal ?? "");
}
