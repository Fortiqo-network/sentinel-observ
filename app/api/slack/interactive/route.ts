import { NextResponse } from "next/server";
import { canDeploy, allowlistConfigured, verifySlackRequest } from "@/lib/slack-verify";
import { deployResultBlocks } from "@/lib/slack-blocks";
import { dispatchDeploy, getDeployTarget, githubOrg, recordDeploy } from "@/lib/deploy";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Slack interactivity endpoint — where deploy buttons land.
 *
 * This is the only route in the app that changes production, so it is
 * defence-in-depth: the request signature proves it came from Slack, and an
 * explicit user allowlist proves *who* clicked. The signature alone is not
 * authorisation — every member of a shared channel can click a button in it.
 *
 * Every attempt is recorded, authorised or not.
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

  const payloadRaw = new URLSearchParams(rawBody).get("payload");
  if (!payloadRaw) return NextResponse.json({ error: "missing payload" }, { status: 400 });

  let payload: {
    type?: string;
    user?: { id?: string; username?: string; name?: string };
    actions?: Array<{ action_id?: string; value?: string }>;
  };
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    return NextResponse.json({ error: "payload is not valid JSON" }, { status: 400 });
  }

  if (payload.type !== "block_actions") {
    return NextResponse.json({ ok: true });
  }

  const action = payload.actions?.[0];
  const actionId = action?.action_id ?? "";
  if (!actionId.startsWith("deploy:")) {
    return NextResponse.json({ ok: true });
  }

  const userId = payload.user?.id;
  const userName = payload.user?.username ?? payload.user?.name ?? null;
  const target = getDeployTarget(action?.value ?? actionId.slice("deploy:".length));

  if (!target) {
    return NextResponse.json({
      response_type: "ephemeral",
      replace_original: false,
      text: `:x: Unknown deploy target \`${action?.value ?? ""}\`.`,
    });
  }

  if (!canDeploy(userId)) {
    await recordDeploy({
      targetId: target.id,
      repo: target.repo,
      actor: userId ?? "unknown",
      actorName: userName,
      ok: false,
      error: "not on the deploy allowlist",
      source: "slack",
    }).catch(() => undefined);

    return NextResponse.json({
      response_type: "ephemeral",
      replace_original: false,
      text: allowlistConfigured()
        ? `:no_entry: <@${userId}> is not on the deploy allowlist.`
        : ":no_entry: Deploys are locked — SLACK_DEPLOY_ALLOWLIST is not set, so nobody is authorised.",
    });
  }

  const result = await dispatchDeploy(target);

  await recordDeploy({
    targetId: target.id,
    repo: target.repo,
    actor: userId ?? "unknown",
    actorName: userName,
    ok: result.ok,
    error: result.ok ? null : result.error,
    source: "slack",
  }).catch(() => undefined);

  return NextResponse.json({
    response_type: "in_channel",
    replace_original: false,
    blocks: deployResultBlocks({
      target,
      ok: result.ok,
      error: result.ok ? undefined : result.error,
      userId: userId ?? "unknown",
      org: githubOrg(),
    }),
  });
}
