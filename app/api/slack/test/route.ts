import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import {
  alarmChannel,
  isSlackConfigured,
  postAlarm,
  postReport,
  reportChannel,
  whoAmI,
  type PostResult,
  type SlackIdentity,
} from "@/lib/slack";

/** Turn a Slack error code into the specific next action, naming the real bot handle. */
function hintFor(result: PostResult, identity: SlackIdentity | { error: string }): string {
  const error = result.ok ? "" : result.error;
  const handle = "handle" in identity && identity.handle ? `@${identity.handle}` : "@<your-bot>";
  const scopes = "scopes" in identity ? identity.scopes : [];

  if (error === "not_in_channel") {
    return `The bot is not a member of that channel. Run \`/invite ${handle}\` in it${
      scopes.includes("chat:write.public")
        ? ""
        : ", or add the chat:write.public scope and reinstall so an invite is never required"
    }.`;
  }
  if (error === "channel_not_found") {
    return "Channel ID is wrong, or the bot cannot see that channel. Copy the ID (C…) from the channel's About tab — not the channel name.";
  }
  if (error === "invalid_auth" || error === "token_revoked") {
    return "SLACK_BOT_TOKEN is wrong or revoked. Recopy it from OAuth & Permissions and redeploy.";
  }
  if (error === "missing_scope") {
    return `Granted scopes are [${scopes.join(", ") || "none"}] — chat:write is required. Add it, then reinstall the app (scope changes need a reinstall).`;
  }
  return `Slack returned \`${error}\`. Granted scopes: [${scopes.join(", ") || "none"}].`;
}

export const dynamic = "force-dynamic";

/**
 * Credential smoke test for the Slack bot (docs/03-slack-bot-setup.md, step 15).
 *
 * Posts one test message to each configured channel and reports exactly which
 * Slack error came back, so a bad token or a missing `/invite` is diagnosed
 * without reading server logs. Guarded by `CRON_SECRET` — otherwise anyone
 * could use it to spam the alarm channel.
 */
async function handle(req: Request): Promise<NextResponse> {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  if (!isSlackConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Slack is not configured",
        missing: [
          !process.env.SLACK_BOT_TOKEN && "SLACK_BOT_TOKEN",
          !process.env.SLACK_ALARM_CHANNEL_ID && "SLACK_ALARM_CHANNEL_ID",
        ].filter(Boolean),
      },
      { status: 503 },
    );
  }

  const identity = await whoAmI();

  const alarm = await postAlarm({
    text: "🟢 Sentinel Observ is connected. This is a test message from the alarm channel.",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "🟢 *Sentinel Observ is connected.*\nThis is a test message — realtime down/recovery alerts will land here.",
        },
      },
    ],
  });

  const sameChannel = reportChannel() === alarmChannel();
  const report = sameChannel
    ? null
    : await postReport({
        text: "📊 Sentinel Observ is connected. Daily and weekly uptime reports will land here.",
      });

  return NextResponse.json({
    ok: alarm.ok && (report === null || report.ok),
    bot: identity,
    alarmChannel: { id: alarmChannel(), result: alarm },
    reportChannel: sameChannel
      ? { id: reportChannel(), result: "same as alarm channel — skipped" }
      : { id: reportChannel(), result: report },
    hint: alarm.ok ? undefined : hintFor(alarm, identity),
  });
}

export const GET = handle;
export const POST = handle;
