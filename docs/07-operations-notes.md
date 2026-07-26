# 07 — Operations notes & incident log

Running log of real operational findings made while building sentinel-observ. Newest first.

## 2026-07-26 — sentinel-runtime crash-restart loop (found & hot-fixed)

**How it was found:** the first ever run of `scripts/probe.mjs` (Phase 1 validation) showed 6/7 services up — `runtime` refused connections on :8004 while every other container had 8–13 days of uptime. `docker ps` showed `sentinel-runtime` in `Restarting (1)` — a silent crash loop nobody had noticed. This is precisely the failure class sentinel-observ exists to catch within 5 minutes.

**Root cause chain:**
1. The container's env file (`/home/trap/actions-runner/_work/sentinel-runtime/sentinel-runtime/.env.production`) had **no `DATABASE_URL`**.
2. Runtime's settings default is `postgresql+asyncpg://localhost:5432/postgres?search_path=runtime` (`src/sentinel_runtime/core/config.py:42`) — `localhost` *inside the container*, where no Postgres exists → `psycopg2.OperationalError: Connection refused` during startup migrations (`alembic upgrade head` runs in the Dockerfile CMD) → crash → restart → repeat.
3. Why the env was missing: runtime's `.github/workflows/deploy.yml` **regenerates `.env.production` from GitHub secrets on every deploy**, and its secret list never included `DATABASE_URL` (unlike core-api/verify/billing/registry, which all have one — see `sentinel-infra/GITHUB_SECRETS.md`).

**Hot-fix applied (2026-07-26, ✅ done, service healthy):**
```bash
# copied the DATABASE_URL + DBMATE_DATABASE_URL lines (search_path=runtime,
# host = Tailscale IP 100.119.231.6, same pattern as core-api) from
# ~/sentinel-runtime/.env into the runner workspace .env.production, then:
cd ~/actions-runner/_work/sentinel-runtime/sentinel-runtime
docker compose up -d
# → /v1/health returns 200, {"status":"ok","stub_mode":true,...}; 7/7 services up
```

**⚠️ Durable fix still PENDING — the hot-fix will be wiped by the next runtime deploy**, because the workflow rewrites `.env.production` from secrets. Two steps, in this order:

1. **Add the GitHub secret first** (repo `Fortiqo-network/sentinel-runtime` → Settings → Secrets and variables → Actions → New repository secret): name `DATABASE_URL`, value = the `postgresql+asyncpg://…search_path=runtime` line from `~/sentinel-runtime/.env` (real values also in `sentinel-infra/secrets.local.md`).
2. **Then patch `.github/workflows/deploy.yml`** (do NOT push this before step 1 — a deploy with the secret unset would recreate the crash loop):
   - env block: add `DATABASE_URL: ${{ secrets.DATABASE_URL }}` after `INTERNAL_SERVICE_TOKEN`
   - in the `{ … } > .env.production` heredoc block, before the closing brace:
     `if [ -n "${DATABASE_URL}" ]; then echo "DATABASE_URL=${DATABASE_URL}"; fi`
     (guarded so a missing secret degrades to today's behaviour instead of writing an empty value)
   - commit as `ci: persist DATABASE_URL into .env.production on deploy` (conventional commit, no attribution trailers — repo policy), push → the triggered redeploy itself validates the fix.

**Lesson for the monitor design:** a service can be "deployed green" (workflow succeeded) yet crash-loop minutes later on startup config. Deploy-status checks are not health checks — only continuous endpoint probing catches this. Also: per-service secret lists drift (4 of 5 backends had `DATABASE_URL`, one didn't); doc 02's inventory should be re-validated with `scripts/probe.mjs` after any deploy-workflow change.

## 2026-07-26 — env-file topology (learned the hard way)

There are **three** env locations per backend service and only one is live:

| Location | Role |
|---|---|
| `~/<repo>/.env` | local dev only — **not** read by the deployed container |
| GitHub repo secrets | source of truth — the deploy workflow writes them into… |
| `~/actions-runner/_work/<repo>/<repo>/.env.production` | the file the running container actually reads (via its workspace `docker-compose.yml` `env_file:`) |

Editing `~/<repo>/.env` does nothing for production; editing the workspace `.env.production` works immediately (`docker compose up -d`) but is **overwritten on next deploy**. Durable change = GitHub secret + workflow line. This is documented in `sentinel-infra/GITHUB_SECRETS.md` and matters for Phase 2 step 2 (adding `MONITOR_TOKEN` to the gateway — it must go in as a gateway GitHub secret + `deploy.yml` line, not just a local file edit).

## Current fleet baseline (2026-07-26, `scripts/probe.mjs`)

```
gateway   🟢 UP  200   ~825ms  (public, via Cloudflare)
frontend  🟢 UP  200   ~647ms  (Vercel)
core-api  🟢 UP  200   ~50ms   (localhost probe)
verify    🟢 UP  200   ~172ms
billing   🟢 UP  200   ~32ms
registry  🟢 UP  200   ~46ms
runtime   🟢 UP  200   ~24ms   (after hot-fix above)
7/7 up
```
