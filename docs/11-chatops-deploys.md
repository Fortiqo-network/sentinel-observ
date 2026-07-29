# 11 — ChatOps deploys (`/deploy` in Slack)

Trigger a backend deploy from a Slack button instead of opening GitHub. Setup is ~10 minutes, all of it in the Slack app config and Vercel.

---

## What this is, and what it is not

**Is:** a button that dispatches a service's existing `deploy.yml` workflow on `main` — exactly what clicking *Run workflow* in the GitHub UI does. No new deploy mechanism, no changes in the service repos (all six already accept `workflow_dispatch`).

**Is not:** a deploy-failure notifier. GitHub's own Slack app already does that well (`/github subscribe Fortiqo-network/sentinel-gateway workflows`), and duplicating it would add nothing.

**The reason it lives here rather than being a standalone bot** is correlation. Because this app records every deploy *and* watches every service, an outage alert can say:

> 🚨 **Deployed 4 minutes before this outage** — by @balraj at 2026-07-29 14:01 UTC. Rolling back is likely faster than debugging.

No deploy-notification integration can tell you that, because it does not know a service went down afterwards. Your own ops log already contains this exact failure mode: a deploy that reported success, then crash-looped minutes later on missing config.

## Security posture — read this before enabling

This is the only part of sentinel-observ that can change production. It cannot sit behind the dashboard password, because Slack cannot log in. So:

| Control | What it does |
|---|---|
| **Signature verification** | Every request must carry a valid `X-Slack-Signature` over the raw body, HMAC-SHA256 with the app's signing secret. Verified before the body is trusted for anything |
| **Replay window** | Requests older than 5 minutes are rejected, so a captured request cannot be replayed |
| **User allowlist** | A valid signature only proves the request came from Slack. **Everyone in a shared channel can click a button**, so `SLACK_DEPLOY_ALLOWLIST` decides who may actually deploy |
| **Confirm dialog** | Slack renders a native confirm step on each button — a mis-tap on a phone cannot deploy production |
| **Audit** | Every attempt is written to `deploys`, including refused ones |
| **Fail closed** | No signing secret ⇒ every request rejected. No allowlist ⇒ nobody can deploy. No `GITHUB_TOKEN` ⇒ the menu says so |

Verified against a running build: unsigned, replayed, tampered-body, and wrong-secret requests are all rejected; an unauthorised click is refused without dispatching.

## Setup

### 1. Get the signing secret

Slack app → **Basic Information** → **App Credentials** → **Signing Secret** → Show → copy.

This is *not* the bot token. It is the shared key Slack uses to sign requests to you.

### 2. Get your Slack user ID

In Slack: your avatar → **Profile** → **⋯** → **Copy member ID**. Looks like `U01ABC23DEF`.

### 3. Create a GitHub token

github.com → Settings → Developer settings → **Fine-grained personal access tokens** → Generate.

- **Resource owner:** `Fortiqo-network`
- **Repository access:** only the six deployable repos (gateway, core-api, billing, verify, registry, runtime)
- **Permissions:** `Actions: Read and write` — nothing else

Classic tokens work too but grant far more than needed; prefer fine-grained.

### 4. Set the Vercel environment variables

sentinel-observ project → Settings → Environment Variables (Production):

```
SLACK_SIGNING_SECRET      <from step 1>
SLACK_DEPLOY_ALLOWLIST    <your member ID from step 2>
GITHUB_TOKEN              <from step 3>
GITHUB_ORG                Fortiqo-network
```

Redeploy.

### 5. Point Slack at the endpoints

Slack app → **Interactivity & Shortcuts** → toggle **On** → Request URL:

```
https://monitor.fortiqo.xyz/api/slack/interactive
```

Slack app → **Slash Commands** → **Create New Command**:

| Field | Value |
|---|---|
| Command | `/deploy` |
| Request URL | `https://monitor.fortiqo.xyz/api/slack/command` |
| Short description | Deploy a Sentinel service |

The bot already has the `commands` scope, so no reinstall is needed. If Slack reports a scope change, reinstall the app (which mints a new bot token — update it in Vercel).

### 6. Use it

Type `/deploy` in any channel the bot is in. You get an **ephemeral** menu — only you see it — with a button per service. Clicking asks for confirmation, then dispatches. The result is posted to the channel so the team sees who deployed what.

## Behaviour

- **Ephemeral menu, public result.** The picker is private so channels don't fill with stale menus; the outcome is public because a deploy is a team event.
- **The dispatch returns no run id.** GitHub answers `204` with an empty body, so the result message links to the workflow's run list rather than the specific run.
- **A green dispatch is not a healthy service.** It means the workflow started. Watch the dashboard — that is exactly the gap the deploy-correlation alert covers.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Slack shows `dispatch_failed` / operation timed out | The Request URL is wrong, or the deployment is not live yet |
| `401` in Vercel logs | `SLACK_SIGNING_SECRET` is wrong or unset |
| "Deploys are locked" | `SLACK_DEPLOY_ALLOWLIST` is unset — this is the fail-closed default |
| "not on the deploy allowlist" | Your member ID is not in the list; the message names the ID to add |
| `workflow or repo not found` | The token lacks `Actions` access on that repo, or the repo name changed |
| `forbidden` | The token has `Actions: Read` but not `Read and write` |

## Extending it

Deliberately narrow: it dispatches an existing workflow and nothing more. If you want rollback-to-previous-image, per-environment targets, or approval chains, those need a real authorisation model — a Slack allowlist is not one. That belongs in the admin console, which already has proper auth.
