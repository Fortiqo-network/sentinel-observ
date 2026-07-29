import { Panel } from "@/components/ui/Panel";
import type { DeployRow } from "@/lib/deploy";
import { getDeployTarget } from "@/lib/deploy";
import { formatDuration, formatUtc, secondsBetween } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

/**
 * Recent deploys triggered from Slack.
 *
 * Sits on the same page as service health on purpose: reading "gateway went
 * down at 14:05" directly above "gateway was deployed at 14:01" answers the
 * first question of an incident without leaving the page.
 */
export function DeploysPanel({
  deploys,
  now,
}: {
  deploys: DeployRow[];
  now: Date;
}): React.JSX.Element {
  return (
    <Panel
      eyebrow="CI/CD"
      title="Recent deploys"
      action={
        <span className="font-brand-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
          /deploy in Slack
        </span>
      }
    >
      {deploys.length === 0 ? (
        <p className="text-sm leading-relaxed text-graphite">
          No deploys triggered from Slack yet. Run <code className="text-gold">/deploy</code> in the
          alarm channel to pick a service. Deploys made directly in GitHub are not recorded here.
        </p>
      ) : (
        <ul className="divide-y divide-porcelain/[0.07]">
          {deploys.map((deploy, index) => {
            const age = secondsBetween(new Date(deploy.triggered_at), now);
            const name = getDeployTarget(deploy.target_id)?.name ?? deploy.target_id;
            return (
              <li key={index} className="flex items-start gap-3 py-3">
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    deploy.ok ? "bg-status-up" : "bg-status-down",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-porcelain">{name}</span>
                    <span className="font-brand-mono text-[11px] text-graphite">
                      {deploy.actor_name ? `@${deploy.actor_name}` : deploy.actor}
                    </span>
                    {!deploy.ok && (
                      <span className="font-brand-mono text-[11px] uppercase tracking-[0.12em] text-status-down">
                        rejected
                      </span>
                    )}
                  </div>
                  {deploy.error && (
                    <p className="mt-0.5 break-words font-brand-mono text-[11px] text-status-down">
                      {deploy.error}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right font-brand-mono text-[11px] text-graphite">
                  <div>{formatDuration(age)} ago</div>
                  <div className="opacity-60">{formatUtc(new Date(deploy.triggered_at))}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
