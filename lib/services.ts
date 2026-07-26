export type ServiceDef = {
  id: string;
  name: string;
  kind: "direct" | "aggregate";
  /** Public URL probed directly (kind: direct) */
  url?: string;
  /** URL the gateway aggregate endpoint calls from inside sentinel-net (kind: aggregate) */
  internal?: string;
  impact: string;
  debug: string;
};

export const SERVICES: ServiceDef[] = [
  {
    id: "gateway",
    name: "Gateway",
    kind: "direct",
    url: "https://sentinel-api.fortiqo.xyz/health",
    impact: "All API traffic is down — the entire platform is unreachable for users.",
    debug: "docker logs sentinel-gateway --tail 100",
  },
  {
    id: "frontend",
    name: "Frontend",
    kind: "direct",
    url: "https://sentinel.fortiqo.xyz/",
    impact: "Web console and marketplace UI unavailable; APIs may still work.",
    debug: "Check Vercel deployment dashboard for sentinel-frontend",
  },
  {
    id: "core-api",
    name: "Core API",
    kind: "aggregate",
    internal: "http://sentinel-core-api:8000/v1/health",
    impact: "Identity, agent lifecycle and marketplace state unavailable.",
    debug: "docker logs sentinel-core-api --tail 100",
  },
  {
    id: "verify",
    name: "Verify",
    kind: "aggregate",
    internal: "http://sentinel-verify:8001/api/v1/health",
    impact: "Verification pipeline and trust scoring halted.",
    debug: "docker logs sentinel-verify --tail 100",
  },
  {
    id: "billing",
    name: "Billing",
    kind: "aggregate",
    internal: "http://sentinel-billing:8002/v1/health",
    impact: "Payments, wallets and settlement unavailable.",
    debug: "docker logs sentinel-billing --tail 100",
  },
  {
    id: "registry",
    name: "Registry",
    kind: "aggregate",
    internal: "http://sentinel-registry:8003/v1/health",
    impact: "Agent artifact publishing and resolution unavailable.",
    debug: "docker logs sentinel-registry --tail 100",
  },
  {
    id: "runtime",
    name: "Runtime",
    kind: "aggregate",
    internal: "http://sentinel-runtime:8004/v1/health",
    impact: "Managed agent execution unavailable (stub service).",
    debug: "docker logs sentinel-runtime --tail 100",
  },
];
