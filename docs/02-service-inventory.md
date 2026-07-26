# 02 — Service inventory

Survey of every `sentinel-*` repo in `/home/trap` (July 2026), and what sentinel-observ does with each.

## Monitored services (7)

| # | Service | Port | Health endpoint | Probed via | Public URL |
|---|---------|------|-----------------|-----------|------------|
| 1 | **sentinel-gateway** | 8080 | `GET /health` | direct: `https://sentinel-api.fortiqo.xyz/health` | ✅ only public backend |
| 2 | **sentinel-frontend** | 3000 (Vercel) | none today → add `/api/health` (optional), else `GET /` expect 200 | direct: `https://sentinel.fortiqo.xyz` | ✅ |
| 3 | **sentinel-core-api** | 8000 | `GET /v1/health` | gateway aggregate | internal |
| 4 | **sentinel-verify** | 8001 | `GET /api/v1/health` ⚠️ different prefix | gateway aggregate | internal |
| 5 | **sentinel-billing** | 8002 | `GET /v1/health` | gateway aggregate | internal |
| 6 | **sentinel-registry** | 8003 | `GET /v1/health` | gateway aggregate | internal |
| 7 | **sentinel-runtime** | 8004 | `GET /v1/health` (service is a deliberate 501 stub, but health works) | gateway aggregate | internal |

⚠️ Health paths are inconsistent across services (`/health` vs `/v1/health` vs `/api/v1/health`). The inventory below is config-driven (`lib/services.ts`) so nothing is hardcoded in probe logic:

```ts
export const SERVICES = [
  { id: "gateway",  name: "Gateway",  kind: "direct",    url: "https://sentinel-api.fortiqo.xyz/health" },
  { id: "frontend", name: "Frontend", kind: "direct",    url: "https://sentinel.fortiqo.xyz/" },
  { id: "core-api", name: "Core API", kind: "aggregate", internal: "http://sentinel-core-api:8000/v1/health" },
  { id: "verify",   name: "Verify",   kind: "aggregate", internal: "http://sentinel-verify:8001/api/v1/health" },
  { id: "billing",  name: "Billing",  kind: "aggregate", internal: "http://sentinel-billing:8002/v1/health" },
  { id: "registry", name: "Registry", kind: "aggregate", internal: "http://sentinel-registry:8003/v1/health" },
  { id: "runtime",  name: "Runtime",  kind: "aggregate", internal: "http://sentinel-runtime:8004/v1/health" },
] as const;
```

(The `internal` URLs are what the *gateway* calls from inside `sentinel-net`; the monitor itself only ever calls the two public hosts.)

## Deliberately NOT monitored

| Repo | Why not |
|---|---|
| `sentinel-sdk` | Library (PyPI/npm packages) — nothing runs |
| `sentinel-shared` | Pure Pydantic contracts library — nothing runs |
| `sentinel-agent-templates` | Templates/fixtures — nothing runs |
| `sentinel-infra` | IaC/compose repo — nothing runs (but it's the source of truth for ports) |
| `sentinel-verify-worker` / `-beat` (Celery) | No HTTP surface. Future option (Phase 3): extend verify's health endpoint to report Celery queue liveness (`celery inspect ping`), which the aggregate would then pick up for free |
| postgres / redis / dozzle containers | Indirectly covered: every FastAPI health check fails if its DB/Redis dependency is broken, and the gateway itself depends on Redis. Direct infra checks are a Phase 3 option |

## Deployment reality (matters for alert wording)

- Backends deploy as GHCR images via `sentinel-infra/docker/docker-compose.prod.yml` on the **self-hosted runner box** (this server). One machine → **correlated failures are expected**: if the box or tunnel dies, gateway + all 5 internal services go red at once. The alerting layer detects this and sends ONE "platform down" alert instead of 6 spam messages (see doc 04, "storm suppression").
- Frontend deploys on Vercel, independent of the server — it usually stays green when the box dies, which is a useful differential signal.
- The infra repo's `docs/observability.md` describes an OTel/Prometheus/Grafana stack for Kubernetes; that is aspirational and not what runs today. sentinel-observ is the pragmatic layer that exists now and does not conflict with adopting that stack later.
