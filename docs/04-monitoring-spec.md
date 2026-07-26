# 04 — Monitoring & alerting spec

## Probe cycle (every 5 minutes, `/api/cron/check`)

1. **Auth**: reject unless `Authorization: Bearer CRON_SECRET` matches.
2. **Probe** all services concurrently:
   - `gateway`, `frontend`: direct `GET` to public URL.
   - The 5 internal services: one call to the gateway aggregate endpoint returns all of them.
3. **Per-probe rules**:
   - Timeout: **8 s** for direct probes, **15 s** for the aggregate call (it needs headroom for its internal 3 s fan-out).
   - **UP** = HTTP 2xx/3xx within timeout. **DOWN** = anything else (5xx, 4xx, timeout, DNS/conn error).
   - **In-run retry**: a failed direct probe is retried up to **2 more times, 3 s apart, in the same run** (the aggregate call gets 2 attempts). Only a full set of failures counts as DOWN. This kills one-off network blips without delaying detection to the next 5-min tick — worst-case detection is still ≤ ~6 min from actual failure, and the worst-case run stays inside the 60 s function limit.
   - A result can also be **unknown** — the aggregate endpoint is not configured yet. Unknown results are recorded and shown as "not monitored", and never alert.
4. **Record** one row per service in `checks` (status, http code, latency, error string).
5. **State machine** per service (previous state from DB → new state):

| Previous | Probe result | Transition | Action |
|---|---|---|---|
| UP | ok | still UP | nothing |
| UP | fail | **went DOWN** | open `incident` row, send 🔴 down alert |
| DOWN | fail | still DOWN | re-alert only at 30 min, then every 60 min ("still down" reminder in the same thread) |
| DOWN | ok | **RECOVERED** | close incident (duration = now − started_at), send 🟢 recovery alert threaded under the down alert |

6. **Storm suppression**: if the transition batch contains gateway-down **plus** ≥2 aggregate services down, send **one combined "platform outage" alert** instead of individual ones (they're one machine — see doc 02). Individual incidents are still recorded in the DB for accurate per-service uptime.

Everything above is idempotent per tick: if GitHub Actions double-fires or fires late, the state machine still only alerts on *transitions*.

## Slack messages (exact formats)

Every message sets a plain-text `text` fallback (what the phone push shows) plus Block Kit `blocks`.

### 🔴 Service down (realtime)

> **🔴 Billing is DOWN**
> **Service:** sentinel-billing (internal, port 8002)
> **Since:** 2026-07-26 10:05 UTC (detected within 5 min)
> **Reason:** `connect ECONNREFUSED` after 3 attempts (timeout 10 s)
> **Last seen up:** 2026-07-26 10:00 UTC
> **Impact:** payments, wallets and settlement are unavailable; other services unaffected.
> **Check:** `docker ps | grep billing` · `docker logs sentinel-billing --tail 100` on the runner box

```json
{
  "text": "🔴 Billing is DOWN — connect ECONNREFUSED (since 10:05 UTC)",
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "🔴 Billing is DOWN" } },
    { "type": "section", "fields": [
      { "type": "mrkdwn", "text": "*Service:*\nsentinel-billing (internal :8002)" },
      { "type": "mrkdwn", "text": "*Since:*\n2026-07-26 10:05 UTC" },
      { "type": "mrkdwn", "text": "*Reason:*\n`connect ECONNREFUSED` ×3 attempts" },
      { "type": "mrkdwn", "text": "*Last seen up:*\n10:00 UTC" }
    ]},
    { "type": "context", "elements": [ { "type": "mrkdwn",
      "text": "Impact: payments/wallets unavailable. Debug: `docker logs sentinel-billing --tail 100`" } ] }
  ]
}
```

Per-service `impact` and `debug` strings live in `lib/services.ts` next to each entry — that's what makes the error message "proper" rather than generic.

Reason strings are normalized from the raw failure:
| Raw failure | Message shown |
|---|---|
| conn refused / DNS / reset | `connect ECONNREFUSED` etc. — "process or box down" |
| timeout | `no response within 10 s ×3 — hung or overloaded` |
| HTTP 5xx | `HTTP 503 from /v1/health — up but unhealthy` + response body snippet (≤200 chars) |
| HTTP 4xx | `HTTP 404 — health route missing/changed (deploy issue?)` |

### 🚨 Platform outage (storm-suppressed)

> **🚨 PLATFORM OUTAGE — gateway + 5 services unreachable**
> Gateway, Core API, Verify, Billing, Registry, Runtime are all down since 10:05 UTC.
> Frontend (Vercel) is still up.
> This pattern = the runner box, Docker, or the tunnel is down — not an app bug.
> **Check first:** is the server on / `cloudflared` tunnel up / `docker compose -f docker-compose.prod.yml ps`

### 🟢 Recovery (threaded under the down alert)

> **🟢 Billing RECOVERED**
> **Downtime:** 23 minutes (10:05 → 10:28 UTC)
> **Checks failed:** 5 · **Now:** HTTP 200 in 41 ms

### 📊 Daily summary (09:00, `TZ` env, default UTC → `#sentinel-reports`)

> **📊 Sentinel daily report — Sat, 26 Jul 2026**
> Overall: **99.4%** uptime · 1 incident · worst: Billing
>
> | Service | Uptime | Incidents | Downtime | Avg / p95 latency |
> |---|---|---|---|---|
> | 🟢 Gateway | 100% | 0 | — | 88 ms / 210 ms |
> | 🟢 Frontend | 100% | 0 | — | 130 ms / 300 ms |
> | 🟢 Core API | 100% | 0 | — | 12 ms / 30 ms |
> | 🟡 Billing | 98.4% | 1 | 23 m | 18 ms / 45 ms |
> | 🟢 Verify / Registry / Runtime | 100% | 0 | — | … |
>
> Incidents: Billing 10:05–10:28 UTC (23 m, ECONNREFUSED)

Rendered as Block Kit sections (Slack has no real tables — one line per service, columns aligned in a fixed-width `context` block). 🟢 =100%, 🟡 <100%, 🔴 <99% or currently down.

### 📈 Weekly summary (Mondays 09:00)

Same table over 7 days, plus:
- **Trend vs previous week** (uptime delta per service, ▲/▼)
- **Total incidents + MTTR** (mean time to recovery)
- **Longest incident** of the week
- Link to the dashboard for drill-down

## Edge cases

| Case | Behaviour |
|---|---|
| Slack API itself fails | The incident's `alert_pending` / `recovery_pending` flag stays set and the next tick re-sends; alerts are never silently dropped. A backlog of storm incidents is re-sent as ONE combined message, not a burst |
| First run ever (no previous state) | Baseline written, **no alerts** — avoids a false alarm burst at install time. A service that is already down at baseline still gets its incident row opened (so uptime and the dashboard are correct from tick one) and the 30-minute "still down" reminder is what surfaces it |
| Service in `maintenance` (flag in DB, toggled via dashboard) | Checks recorded but alerts muted; summaries mark the window "maintenance" and exclude it from uptime % |
| GitHub Actions misses a tick entirely | Gap visible in dashboard; uptime math uses actual timestamps so no fake downtime is recorded. A meta-check: if `/api/cron/daily` sees < 250 checks/day (~288 expected), the daily report includes a ⚠️ "monitor itself missed N ticks" line |
| Runtime returns 501 on real endpoints | Irrelevant — we only probe `/v1/health`, which returns 200 by design |
