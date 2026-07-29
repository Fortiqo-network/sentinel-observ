import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Slack request authentication.
 *
 * These endpoints are the one part of this app that can change production, and
 * they cannot sit behind the dashboard password because Slack cannot log in.
 * The signature is therefore the entire perimeter, and it is verified before
 * the request body is trusted for anything.
 *
 * Slack signs `v0:{timestamp}:{raw body}` with the app's signing secret. The
 * raw body matters: re-serializing parsed form data produces a different string
 * and every signature would fail, so callers must pass the exact text received.
 *
 * https://docs.slack.dev/authentication/verifying-requests-from-slack/
 */

/** Requests older than this are rejected, so a captured request cannot be replayed. */
const MAX_SKEW_SECONDS = 60 * 5;

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function isSlackSigningConfigured(): boolean {
  return Boolean(process.env.SLACK_SIGNING_SECRET);
}

/** Verify a Slack request's signature and freshness. Fails closed. */
export function verifySlackRequest(params: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
}): VerifyResult {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return { ok: false, reason: "SLACK_SIGNING_SECRET is not set" };
  if (!params.signature || !params.timestamp) {
    return { ok: false, reason: "missing Slack signature headers" };
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(params.timestamp));
  if (!Number.isFinite(age) || age > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale or invalid timestamp" };
  }

  const expected =
    "v0=" +
    createHmac("sha256", secret)
      .update(`v0:${params.timestamp}:${params.rawBody}`)
      .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(params.signature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

/**
 * Whether a Slack user may trigger deploys.
 *
 * Fails closed: with `SLACK_DEPLOY_ALLOWLIST` unset nobody can deploy, because
 * a valid signature only proves the request came from Slack — every member of
 * the workspace can click a button in a shared channel.
 */
export function canDeploy(slackUserId: string | undefined): boolean {
  const allowlist = (process.env.SLACK_DEPLOY_ALLOWLIST ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return Boolean(slackUserId) && allowlist.includes(slackUserId!);
}

export function allowlistConfigured(): boolean {
  return Boolean(process.env.SLACK_DEPLOY_ALLOWLIST?.trim());
}
