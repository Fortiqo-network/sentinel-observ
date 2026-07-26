# 03 — Slack bot setup (super baby steps)

Goal: a Slack bot that posts outage alarms and uptime reports. **~10 minutes, no code.** At the end you will hold three values to paste into Vercel.

---

## Part 1 — Create the Slack app (the "bot")

1. Open **https://api.slack.com/apps** in your browser and sign in to the Slack workspace where alerts should land.
2. Click the green **"Create New App"** button.
3. Choose **"From scratch"**.
4. Fill in:
   - **App Name:** `Sentinel Observ`
   - **Pick a workspace:** your team's workspace
5. Click **"Create App"**. You land on the app's settings page.

## Part 2 — Give the bot permission to post

6. In the left sidebar click **"OAuth & Permissions"**.
7. Scroll to **"Scopes" → "Bot Token Scopes"** and click **"Add an OAuth Scope"** twice, adding:
   - `chat:write` — lets the bot send messages
   - `chat:write.public` — lets it post in public channels without being invited (we still invite it; this just avoids surprises)
8. Scroll back to the **top of the same page** and click **"Install to Workspace"**. (If it says "Request to Install", a workspace admin has to approve it.)
9. Click **"Allow"** on the consent screen.
10. You are back on OAuth & Permissions. Copy the **"Bot User OAuth Token"** — it starts with `xoxb-`.
    → **This is `SLACK_BOT_TOKEN`.** Treat it like a password: never commit it, never paste it in a chat or ticket. It goes only into Vercel's environment variables.

## Part 3 — Create the channels and connect the bot

11. In Slack, create two channels (➕ next to "Channels" → "Create channel"):
    - **`#sentinel-alarms`** — realtime down/recovery alerts. Turn notifications ON for everyone on call (channel → ⚙️ → Notifications → **All messages**), otherwise a 3 AM outage pings nobody.
    - **`#sentinel-reports`** — daily/weekly summaries. Kept separate so a report never buries an active alarm. (You can use one channel for both; leave `SLACK_REPORT_CHANNEL_ID` unset and reports go to the alarm channel.)
12. In **each** channel, type `/invite @Sentinel Observ` and press Enter.
13. Get each channel's **Channel ID**: click the channel name at the top → scroll to the bottom of the "About" tab → copy the ID that looks like `C0123ABCDEF`.
    - `#sentinel-alarms` → **`SLACK_ALARM_CHANNEL_ID`**
    - `#sentinel-reports` → **`SLACK_REPORT_CHANNEL_ID`**

## Part 4 — Put the three values into Vercel

14. Vercel → the **sentinel-observ** project → **Settings → Environment Variables**. Add:

| Name | Value | Environments |
|---|---|---|
| `SLACK_BOT_TOKEN` | `xoxb-…` from step 10 | Production (+ Preview if you want) |
| `SLACK_ALARM_CHANNEL_ID` | `C…` from step 13 | Production |
| `SLACK_REPORT_CHANNEL_ID` | `C…` from step 13 (optional) | Production |

15. **Redeploy** (Deployments → ⋯ → Redeploy). Environment variables are read at boot; an existing deployment will not pick them up.

## Part 5 — Prove it works

16. Call the built-in credential test (it posts one message to each configured channel and tells you exactly what Slack said):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<observ-url>/api/slack/test
```

Expected: `"ok": true`, and a 🟢 message appears in `#sentinel-alarms`.

If it fails, the response names the Slack error:

| Slack error | Fix |
|---|---|
| `not_in_channel` | Redo step 12 — the bot is not in that channel |
| `invalid_auth` | Token pasted wrong or revoked — recopy from step 10, redeploy |
| `channel_not_found` | Channel **ID** wrong (you may have pasted the name) — redo step 13 |
| `missing_scope` | Redo step 7, then **reinstall** the app (step 8) — scope changes need a reinstall |

If you cannot run curl, the same check runs from a browser only when you can attach the header — use the terminal, or trigger a real tick from GitHub Actions (Actions → *monitor* → Run workflow) and watch the channel.

---

## What you will see in Slack

- **🔴 Down** — the moment a service fails three probes: which service, the exact reason, since when, last seen up, what it breaks for users, and the first command to run.
- **🚨 Platform outage** — when the gateway *and* two or more internal services fail together, one message replaces six. They share a machine, so that pattern is one root cause, and six alerts train people to ignore the channel.
- **⏰ Still down** — a threaded nudge at 30 minutes, then hourly.
- **🟢 Recovered** — threaded under the original alarm, with exact downtime and how many checks failed.
- **📊 Daily / 📈 Weekly** — uptime table per service, incidents, latency, MTTR, and week-over-week trend.

Exact payloads: [04-monitoring-spec.md](04-monitoring-spec.md).

## Why a bot token and not an Incoming Webhook?

A webhook is one step simpler but is locked to a single channel (we post to two), cannot thread recovery messages under the original alarm, cannot be scoped or rotated independently, and lets anyone holding the URL post. `chat.postMessage` with a bot token is the same single `fetch` call and keeps every option open.

## Handing the credentials over safely

Never paste `xoxb-…` into a chat, an issue, a commit, or a screenshot. Put it straight into Vercel (and GitHub Actions secrets for `CRON_SECRET`). If a token is ever exposed, rotate it immediately: **api.slack.com/apps → your app → OAuth & Permissions → Revoke**, then reinstall to mint a fresh token.

The only values that ever need to leave Slack are the three in step 14 — the app never asks for a user token, never reads messages, and holds no other Slack permission.
