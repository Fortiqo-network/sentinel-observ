import { query } from "./db";
import { hasDatabase } from "./db";
import { ensureSchema } from "./schema";

/**
 * ChatOps deploys: triggering a service's GitHub Actions deploy workflow.
 *
 * Every backend deploys through an identically-shaped `deploy.yml` that already
 * accepts `workflow_dispatch`, so this needs no changes in those repos — it
 * dispatches the workflow that a human would otherwise click in the GitHub UI.
 *
 * The frontend, docs and this app deploy on Vercel from a git push and are
 * deliberately absent: there is no workflow to dispatch, and "redeploy" there
 * means something different.
 */

export type DeployTarget = {
  id: string;
  name: string;
  repo: string;
  workflow: string;
  /** Matching entry in the service inventory, when the deploy is observable. */
  serviceId?: string;
};

export const DEPLOY_TARGETS: DeployTarget[] = [
  { id: "gateway", name: "Gateway", repo: "sentinel-gateway", workflow: "deploy.yml", serviceId: "gateway" },
  { id: "core-api", name: "Core API", repo: "sentinel-core-api", workflow: "deploy.yml", serviceId: "core-api" },
  { id: "billing", name: "Billing", repo: "sentinel-billing", workflow: "deploy.yml", serviceId: "billing" },
  { id: "verify", name: "Verify", repo: "sentinel-verify", workflow: "deploy.yml", serviceId: "verify" },
  { id: "registry", name: "Registry", repo: "sentinel-registry", workflow: "deploy.yml", serviceId: "registry" },
  { id: "runtime", name: "Runtime", repo: "sentinel-runtime", workflow: "deploy.yml", serviceId: "runtime" },
];

export function getDeployTarget(id: string): DeployTarget | undefined {
  return DEPLOY_TARGETS.find((t) => t.id === id);
}

export function githubOrg(): string {
  return process.env.GITHUB_ORG ?? "Fortiqo-network";
}

export function isDeployConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}

export type DispatchResult = { ok: true } | { ok: false; error: string };

/**
 * Trigger a deploy workflow on `main`.
 *
 * GitHub answers 204 with no body and no run id, so the caller cannot link
 * straight to the run — the audit row and the repo's Actions tab are how a
 * dispatch is traced afterwards.
 */
export async function dispatchDeploy(target: DeployTarget, ref = "main"): Promise<DispatchResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, error: "GITHUB_TOKEN is not set" };

  const url = `https://api.github.com/repos/${githubOrg()}/${target.repo}/actions/workflows/${target.workflow}/dispatches`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref }),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 204) return { ok: true };

    const body = await res.text();
    if (res.status === 404) {
      return {
        ok: false,
        error: "workflow or repo not found — check GITHUB_TOKEN has Actions: read+write on this repo",
      };
    }
    if (res.status === 403) {
      return { ok: false, error: "forbidden — the token lacks Actions: write on this repo" };
    }
    return { ok: false, error: `GitHub returned HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Record who deployed what.
 *
 * Written whether or not the dispatch succeeded: a rejected attempt is exactly
 * the thing worth having a record of. Also what makes the dashboard able to
 * answer "did a deploy precede this outage?".
 */
export async function recordDeploy(params: {
  targetId: string;
  repo: string;
  actor: string;
  actorName: string | null;
  ok: boolean;
  error: string | null;
  source: string;
}): Promise<void> {
  if (!hasDatabase()) return;
  await ensureSchema();
  await query(
    `INSERT INTO deploys (target_id, repo, actor, actor_name, ok, error, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.targetId,
      params.repo,
      params.actor,
      params.actorName,
      params.ok,
      params.error,
      params.source,
    ],
  );
}

export type DeployRow = {
  target_id: string;
  repo: string;
  actor: string;
  actor_name: string | null;
  ok: boolean;
  error: string | null;
  source: string;
  triggered_at: Date;
};

export async function listDeploys(limit = 10): Promise<DeployRow[]> {
  if (!hasDatabase()) return [];
  return query<DeployRow>(
    `SELECT target_id, repo, actor, actor_name, ok, error, source, triggered_at
     FROM deploys ORDER BY triggered_at DESC LIMIT $1`,
    [limit],
  );
}

/**
 * Deploys of a service shortly before a moment in time.
 *
 * This is the point of recording them: "gateway went down four minutes after it
 * was deployed" is the first thing worth knowing during an incident, and no
 * deploy-notification integration can tell you it, because it does not know
 * about the outage.
 */
export async function recentDeploysBefore(
  serviceId: string,
  before: Date,
  withinMinutes = 30,
): Promise<DeployRow[]> {
  if (!hasDatabase()) return [];
  return query<DeployRow>(
    `SELECT target_id, repo, actor, actor_name, ok, error, source, triggered_at
     FROM deploys
     WHERE target_id = $1
       AND ok = true
       AND triggered_at <= $2::timestamptz
       AND triggered_at > $2::timestamptz - ($3::int * INTERVAL '1 minute')
     ORDER BY triggered_at DESC`,
    [serviceId, before, withinMinutes],
  );
}
