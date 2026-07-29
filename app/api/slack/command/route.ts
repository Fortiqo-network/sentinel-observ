import { NextResponse } from "next/server";
import { canDeploy, isSlackSigningConfigured, verifySlackRequest } from "@/lib/slack-verify";
import { deployMenuBlocks } from "@/lib/slack-blocks";
import { isDeployConfigured } from "@/lib/deploy";

export const dynamic = "force-dynamic";

/**
 * Slack slash command entry point (`/deploy`).
 *
 * Answers ephemerally — the picker is only useful to the person who asked, and
 * a channel full of stale deploy menus invites mis-clicks.
 *
 * Not behind the dashboard password: Slack cannot log in, so the request
 * signature is the perimeter. It is verified before anything in the body is
 * trusted, and the response is always 200 so Slack shows a useful message
 * instead of "operation timed out".
 */
export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();

  const verified = verifySlackRequest({
    rawBody,
    signature: req.headers.get("x-slack-signature"),
    timestamp: req.headers.get("x-slack-request-timestamp"),
  });
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: 401 });
  }

  const form = new URLSearchParams(rawBody);
  const userId = form.get("user_id") ?? undefined;

  if (!isDeployConfigured()) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Deploys are not configured: GITHUB_TOKEN is unset on the monitor.",
    });
  }

  const allowed = canDeploy(userId);
  return NextResponse.json({
    response_type: "ephemeral",
    blocks: deployMenuBlocks({
      canDeploy: allowed,
      reason: allowed
        ? undefined
        : `Add \`${userId ?? "your user id"}\` to SLACK_DEPLOY_ALLOWLIST to grant access.`,
    }),
  });
}

/** Slack only ever POSTs; a GET means someone opened the URL in a browser. */
export function GET(): NextResponse {
  return NextResponse.json(
    {
      error: "this endpoint accepts signed Slack POST requests only",
      signingSecretConfigured: isSlackSigningConfigured(),
    },
    { status: 405 },
  );
}
