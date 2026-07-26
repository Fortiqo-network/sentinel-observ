# 03 — Slack bot setup (super baby steps)

Goal: a Slack bot that can post into an alarm channel and a reports channel. Takes ~10 minutes, no code required until step 8.

## Part 1 — Create the Slack app (the "bot")

1. Open your browser, go to **https://api.slack.com/apps** and sign in to the Slack workspace where alerts should land.
2. Click the green **"Create New App"** button.
3. Choose **"From scratch"**.
4. Fill in:
   - **App Name:** `Sentinel Observ`
   - **Pick a workspace:** select your team's workspace
5. Click **"Create App"**. You land on the app's settings page.

## Part 2 — Give the bot permission to post messages

6. In the left sidebar click **"OAuth & Permissions"**.
7. Scroll down to **"Scopes" → "Bot Token Scopes"** and click **"Add an OAuth Scope"**. Add these two:
   - `chat:write` — lets the bot send messages
   - `chat:write.public` — lets it post in public channels without being invited (we'll still invite it, but this avoids surprises)
8. Scroll back to the **top** of the same page and click **"Install to Workspace"** (may say "Request to Install" if the workspace needs admin approval — approve it as admin).
9. Click **"Allow"** on the consent screen.
10. You're back on OAuth & Permissions. Copy the **"Bot User OAuth Token"** — it starts with `xoxb-`.
    **This is `SLACK_BOT_TOKEN`. Treat it like a password: never commit it; it goes only into Vercel/GitHub secrets.**

## Part 3 — Create the channels and connect the bot

11. In Slack itself, create two channels (➕ next to "Channels" → "Create channel"):
    - **`#sentinel-alarms`** — realtime down/recovery alerts. Turn ON channel notifications for everyone who's on call (channel → ⚙️ → Notifications → **All messages**), otherwise a 3 AM outage pings nobody.
    - **`#sentinel-reports`** — daily/weekly summaries (kept separate so reports never bury an active alarm; use one channel for both if you prefer).
12. In each channel, type `/invite @Sentinel Observ` and press enter (or: channel name → ⚙️ → Integrations → Add apps → Sentinel Observ).
13. Get each channel's **Channel ID**: click the channel name at the top → scroll to the bottom of the "About" tab → copy the ID that looks like `C0123ABCDEF`.
    - `#sentinel-alarms` ID → **`SLACK_ALARM_CHANNEL_ID`**
    - `#sentinel-reports` ID → **`SLACK_REPORT_CHANNEL_ID`**

## Part 4 — Test it end to end (before writing any app code)

14. From the server, run (paste your real token and channel ID):

```bash
curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer xoxb-YOUR-TOKEN-HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "C0123ABCDEF",
    "text": "🟢 Sentinel Observ bot is connected. Test message."
  }'
```

15. Check the response in the terminal contains `"ok":true` **and** the message appears in `#sentinel-alarms`.
    - `"ok":false, "error":"not_in_channel"` → redo step 12 (invite the bot).
    - `"ok":false, "error":"invalid_auth"` → token pasted wrong; recopy from step 10.
    - `"ok":false, "error":"channel_not_found"` → channel ID pasted wrong; redo step 13.

Done. The three values to save as secrets:

| Secret | Example | Where it's used |
|---|---|---|
| `SLACK_BOT_TOKEN` | `xoxb-…` | Vercel env (server-side only) |
| `SLACK_ALARM_CHANNEL_ID` | `C0…` | Vercel env |
| `SLACK_REPORT_CHANNEL_ID` | `C0…` | Vercel env |

## Why a bot token and not an Incoming Webhook?

A webhook would also work and is one step simpler, but: a webhook is locked to a single channel (we post to two), can't be rotated per-scope, can't later add reactions/threads (we thread recovery messages under the original alarm, doc 04), and anyone holding the URL can post without auth context. `chat.postMessage` with a bot token is one identical `fetch` call and keeps all options open.

## Sending from code (what Phase 2 implements)

No Slack SDK dependency needed — it's one HTTPS call:

```ts
// lib/slack.ts
export async function postMessage(channel: string, text: string, blocks?: object[]) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, text, blocks, unfurl_links: false }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack error: ${data.error}`);
  return data; // data.ts = message timestamp, saved to thread recovery replies
}
```

`text` is always set (it's the fallback for push notifications); `blocks` carries the pretty formatting (doc 04 has every payload).
