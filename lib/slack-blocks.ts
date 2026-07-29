import type { SlackBlock } from "./slack";
import { DEPLOY_TARGETS, type DeployTarget } from "./deploy";

/**
 * Block Kit payloads for the deploy surface.
 *
 * Each button carries a native `confirm` dialog. Slack renders it client-side,
 * so a two-step confirmation for a production deploy costs nothing and cannot
 * be skipped by a mis-tap on a phone.
 */

/** The service picker posted by `/deploy`. */
export function deployMenuBlocks(params: { canDeploy: boolean; reason?: string }): SlackBlock[] {
  if (!params.canDeploy) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:no_entry: *Not authorised to deploy.*\n${params.reason ?? "Your Slack user is not on the deploy allowlist."}`,
        },
      },
    ];
  }

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Deploy a service* — this triggers the repo's `deploy.yml` on `main`, exactly as clicking *Run workflow* in GitHub would.",
      },
    },
    ...chunk(DEPLOY_TARGETS, 5).map((group) => ({
      type: "actions",
      elements: group.map((target) => deployButton(target)),
    })),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Deploys build a fresh image and restart the container. Watch the service on the dashboard afterwards — a green deploy is not proof of a healthy service.",
        },
      ],
    },
  ];
}

function deployButton(target: DeployTarget): SlackBlock {
  return {
    type: "button",
    text: { type: "plain_text", text: target.name, emoji: false },
    value: target.id,
    action_id: `deploy:${target.id}`,
    confirm: {
      title: { type: "plain_text", text: `Deploy ${target.name}?` },
      text: {
        type: "mrkdwn",
        text: `This redeploys *${target.repo}* from \`main\` to production and restarts the container.`,
      },
      confirm: { type: "plain_text", text: "Deploy" },
      deny: { type: "plain_text", text: "Cancel" },
      style: "danger",
    },
  };
}

/** Replacement message shown after a button is clicked. */
export function deployResultBlocks(params: {
  target: DeployTarget;
  ok: boolean;
  error?: string;
  userId: string;
  org: string;
}): SlackBlock[] {
  const runsUrl = `https://github.com/${params.org}/${params.target.repo}/actions/workflows/${params.target.workflow}`;

  if (!params.ok) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:x: *Could not deploy ${params.target.name}*\n\`${params.error ?? "unknown error"}\``,
        },
      },
    ];
  }

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:rocket: *${params.target.name} deploy triggered* by <@${params.userId}>\n\`${params.target.repo}\` → \`deploy.yml\` on \`main\``,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          // GitHub's dispatch API returns 204 with no run id, so the workflow
          // list is the closest thing to a direct link.
          text: `<${runsUrl}|Watch the run> · the monitor will alert if the service goes unhealthy afterwards.`,
        },
      ],
    },
  ];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
