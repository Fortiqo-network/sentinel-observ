/**
 * Slack transport — one `chat.postMessage` call, no SDK dependency.
 *
 * Every message carries a plain-text `text` fallback (that is what a phone push
 * notification shows) plus Block Kit `blocks` for the formatted body. The
 * returned message `ts` is stored on the incident so the recovery message can
 * be threaded under the original alarm.
 */

export type SlackBlock = Record<string, unknown>;

export type PostResult = { ok: true; ts: string | null } | { ok: false; error: string };

const SLACK_API = "https://slack.com/api/chat.postMessage";
const TIMEOUT_MS = 8_000;

/** True when a bot token and at least the alarm channel are configured. */
export function isSlackConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN && alarmChannel());
}

export function alarmChannel(): string | undefined {
  return process.env.SLACK_ALARM_CHANNEL_ID;
}

/** Reports fall back to the alarm channel when no separate channel is set. */
export function reportChannel(): string | undefined {
  return process.env.SLACK_REPORT_CHANNEL_ID ?? process.env.SLACK_ALARM_CHANNEL_ID;
}

/**
 * Post a message. Never throws: a Slack outage must not fail the monitoring
 * tick, and the caller re-sends pending alerts on the next tick instead.
 */
export async function postMessage(params: {
  channel: string | undefined;
  text: string;
  blocks?: SlackBlock[];
  threadTs?: string | null;
}): Promise<PostResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, error: "SLACK_BOT_TOKEN is not set" };
  if (!params.channel) return { ok: false, error: "no Slack channel configured" };

  try {
    const res = await fetch(SLACK_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: params.channel,
        text: params.text,
        blocks: params.blocks,
        thread_ts: params.threadTs ?? undefined,
        unfurl_links: false,
        unfurl_media: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
    if (!data.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, ts: data.ts ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Post to the realtime alarm channel. */
export function postAlarm(params: {
  text: string;
  blocks?: SlackBlock[];
  threadTs?: string | null;
}): Promise<PostResult> {
  return postMessage({ channel: alarmChannel(), ...params });
}

/** Post to the daily/weekly report channel. */
export function postReport(params: { text: string; blocks?: SlackBlock[] }): Promise<PostResult> {
  return postMessage({ channel: reportChannel(), ...params });
}
