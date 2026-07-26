import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { alarmChannel, isSlackConfigured, postAlarm, postReport, reportChannel } from "@/lib/slack";

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
    alarmChannel: { id: alarmChannel(), result: alarm },
    reportChannel: sameChannel
      ? { id: reportChannel(), result: "same as alarm channel — skipped" }
      : { id: reportChannel(), result: report },
    hint:
      alarm.ok
        ? undefined
        : "not_in_channel → run /invite @Sentinel Observ · invalid_auth → recopy SLACK_BOT_TOKEN · channel_not_found → recheck the channel ID",
  });
}

export const GET = handle;
export const POST = handle;
