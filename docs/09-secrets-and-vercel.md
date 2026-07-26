# 09 — Secrets & Vercel settings (canonical reference)

Everything that has to be configured, in one table per location. If a value appears in two places it must be **byte-identical** in both — that is the single most common cause of a monitor that looks wired but silently sees nothing.

---

## 1. Vercel — sentinel-observ project environment variables

**Settings → Environment Variables.** Scope every one of these to **Production only** unless noted.

| Name | Value | Without it |
|---|---|---|
| `CRON_SECRET` | `openssl rand -hex 32` | `/api/cron/*` returns 503 — nothing is ever checked on a schedule |
| `MONITOR_TOKEN` | `openssl rand -hex 32` | The 5 internal services show *not monitored* |
| `GATEWAY_URL` | `https://sentinel-api.fortiqo.xyz` | Same as above |
| `SLACK_BOT_TOKEN` | `xoxb-…` | No alerts, no reports. Everything else still works |
| `SLACK_ALARM_CHANNEL_ID` | `C0BKP4MKSGK` | Same as above |
| `SLACK_REPORT_CHANNEL_ID` | a second `C…` (optional) | Reports go to the alarm channel |
| `DASHBOARD_URL` | `https://monitor.fortiqo.xyz` | Slack alerts carry no link back |
| `DATABASE_URL` | **injected by the Neon integration — do not type it in** | Live-probe-only: no history, no incidents, no alerts |

> **Do not add the Slack variables to the Preview scope.** A preview deployment with a valid bot token can post real alarms into the real channel from a branch. Left unset, `isSlackConfigured()` returns false and previews stay silent — which is the behaviour you want.

**Environment variables are read at boot.** After adding or changing any of them: Deployments → ⋯ → **Redeploy**. An already-running deployment will not pick them up.

## 2. GitHub — `Fortiqo-network/sentinel-observ`

**Settings → Secrets and variables → Actions.**

| Kind | Name | Value | Notes |
|---|---|---|---|
| Secret | `CRON_SECRET` | **same value as Vercel** | Required. The scheduler cannot authenticate without it |
| Secret | `SLACK_BOT_TOKEN` | same `xoxb-…` as Vercel | Optional. Only used to tell you the *monitor itself* failed |
| Secret | `SLACK_ALARM_CHANNEL_ID` | `C0BKP4MKSGK` | Optional, pairs with the above |
| Variable | `OBSERV_URL` | — | **Leave unset.** The workflow defaults to `https://monitor.fortiqo.xyz`. Set it only to aim the scheduler at a preview deployment |

The two optional Slack secrets close a real gap: if a deploy breaks or `CRON_SECRET` drifts, the workflow fails and the dashboard keeps showing "no incidents" because nothing is being checked. With them set, a failed run posts *"the platform is currently UNWATCHED"* to the alarm channel. Without them the step is skipped silently — nothing breaks, you just lose that warning.

## 3. GitHub — `Fortiqo-network/sentinel-gateway`

**Settings → Secrets and variables → Actions.**

| Name | Value | Notes |
|---|---|---|
| `MONITOR_TOKEN` | **same value as the Vercel `MONITOR_TOKEN`** | Add this **before** deploying — see below |

The deploy workflow already reads it (`.github/workflows/deploy.yml`) and writes it into `.env.production` behind an `if [ -n … ]` guard, so a missing secret leaves the endpoint disabled (503, fail-closed) rather than writing a blank value.

> The `deploy` job declares `environment: production`. If your org keeps secrets on that GitHub Environment rather than at repository level, add `MONITOR_TOKEN` there instead — either location resolves.

> Your editor may flag `Context access might be invalid: MONITOR_TOKEN` on the workflow. That is the GitHub Actions extension noticing the secret does not exist **yet**. It disappears once you add it.

## 4. Values that must match across locations

| Value | Lives in | Symptom when they drift |
|---|---|---|
| `CRON_SECRET` | Vercel + sentinel-observ GH secret | Every scheduled run fails with 401; dashboard silently stops updating |
| `MONITOR_TOKEN` | Vercel + sentinel-gateway GH secret | 5 internal services stuck on *not monitored* — the gateway rejects the token |
| `SLACK_BOT_TOKEN` | Vercel + (optionally) sentinel-observ GH secret | Alerts work but the "monitor is down" warning does not, or vice versa |

---

## 5. Vercel project settings

### Build & Development

| Setting | Value |
|---|---|
| Framework Preset | **Next.js** (auto-detected) |
| Root Directory | `./` |
| Build Command | default (`next build`) |
| Install Command | default — `package-lock.json` is committed, so Vercel uses `npm ci` |
| Output Directory | default (`.next`) |
| Node.js Version | **22.x** |

Nothing needs overriding. There is deliberately no `vercel.json`: the only setting it would carry is the function region, and a wrong value there fails the whole deploy, so it belongs in the dashboard where you can see it resolve.

### Functions

- **Max duration** is set per route in code (`export const maxDuration = 60`), not in project settings. The worst-case tick — 3 attempts × 8 s plus 3 s waits, in parallel with a 15 s aggregate call — lands around 30 s, comfortably inside it.
- **Region:** the default is `iad1` (Washington DC). Consider **`bom1` (Mumbai)** — the backend runs on a self-hosted box in India, so probes from Mumbai are faster, less likely to hit a spurious timeout, and the recorded latency reflects the network path your traffic actually takes. The trade-off is honest: latency figures will look better than what a US visitor experiences. For up/down detection — which is what this app is for — closer is better.

### Deployment Protection

**Settings → Deployment Protection → turn Vercel Authentication OFF for Production.**

With it on, the scheduler's `curl` receives an SSO login page instead of the endpoint and every run fails with a 401. This is safe: the dashboard is read-only and exposes no secrets, and `/api/cron/*` enforces its own `CRON_SECRET`. If policy requires protection, generate a **Protection Bypass for Automation** token and send it as `x-vercel-protection-bypass` in the workflow.

Leave protection **on for Preview** — that is the default and it keeps branch deployments private.

### Domains

**Settings → Domains → Add → `monitor.fortiqo.xyz`.** Then in Cloudflare, on the `fortiqo.xyz` zone:

| Type | Name | Target | Proxy | TTL |
|---|---|---|---|---|
| `CNAME` | `monitor` | `cname.vercel-dns.com` | **DNS only** (grey cloud) | Auto |

Grey cloud, not orange. With the proxy on, Cloudflare terminates TLS itself, which can block Vercel from issuing and auto-renewing the certificate and stacks two CDNs for no benefit.

### Storage

**Storage → Create Database → Neon → Free.** Connect it to the project; `DATABASE_URL` is injected automatically. **No migration to run** — the schema is idempotent DDL in `lib/schema.ts`, applied on the first tick.

### Git

Production Branch `main`. Every push to `main` deploys. There is no GitHub Actions build for this repo — Vercel owns CI/CD; the workflow here is only the scheduler.

---

## 6. Rotating a credential

**Slack bot token** — api.slack.com/apps → your app → OAuth & Permissions → *Revoke*, then *Reinstall to Workspace* → copy the new `xoxb-`. Update it in Vercel (+ the GitHub secret if set) → Redeploy. Scope changes also require a reinstall and also mint a new token, so batch them together.

**`CRON_SECRET`** — generate, update Vercel, redeploy, *then* update the GitHub secret. In that order there is one failed tick at worst; reversed, every tick fails until the redeploy finishes.

**`MONITOR_TOKEN`** — generate, add to the gateway's GitHub secret, redeploy the gateway, *then* update Vercel and redeploy. During the gap the internal services report *not monitored*, which does not page anyone.

Nothing here is ever committed. `.gitignore` covers `.env` and `.env.*` with only `.env.example` whitelisted; `.env.local` is for local development and stays on your machine.
