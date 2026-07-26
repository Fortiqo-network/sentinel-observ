import type { DashboardData } from "@/lib/dashboard";
import { cn } from "@/lib/utils/cn";

type Item = { label: string; ready: boolean; envVars: string[]; detail: string };

/**
 * Wiring status for the monitor itself.
 *
 * Each row names the exact environment variables that turn a capability on, so
 * a half-configured deployment explains itself on screen instead of failing
 * silently. The panel disappears once everything is connected.
 */
export function ConfigChecklist({ config }: { config: DashboardData["config"] }): React.JSX.Element | null {
  const items: Item[] = [
    {
      label: "Internal service probes",
      ready: config.aggregate,
      envVars: ["GATEWAY_URL", "MONITOR_TOKEN"],
      detail:
        "Reads core-api, verify, billing, registry and runtime through the gateway's aggregate health endpoint. Until it is set, those five show as not monitored.",
    },
    {
      label: "Slack alerting",
      ready: config.slack,
      envVars: ["SLACK_BOT_TOKEN", "SLACK_ALARM_CHANNEL_ID", "SLACK_REPORT_CHANNEL_ID"],
      detail:
        "Realtime down/recovery alerts plus daily and weekly reports. Verify with GET /api/slack/test.",
    },
    {
      label: "History & uptime records",
      ready: config.database,
      envVars: ["DATABASE_URL"],
      detail:
        "Postgres storage for checks, incidents and rollups. Without it the page still probes live, but nothing is remembered and no alert can fire.",
    },
    {
      label: "Scheduled checks",
      ready: config.scheduler,
      envVars: ["CRON_SECRET"],
      detail:
        "Authenticates the GitHub Actions scheduler that calls /api/cron/check every 5 minutes.",
    },
  ];

  if (items.every((item) => item.ready)) return null;

  return (
    <section className="panel border-gold/25 bg-gold/[0.04] p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-gold" />
        <h2 className="text-[15px] font-semibold tracking-tight text-porcelain">
          Setup incomplete — {items.filter((i) => !i.ready).length} of {items.length} capabilities off
        </h2>
      </div>
      <p className="mt-1.5 text-xs text-graphite">
        Set these in the Vercel project&apos;s environment variables and redeploy.
      </p>

      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.label} className="flex gap-3">
            <span
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                item.ready ? "bg-status-up/20 text-status-up" : "bg-porcelain/10 text-graphite",
              )}
            >
              {item.ready ? "✓" : "!"}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "text-sm font-medium",
                    item.ready ? "text-porcelain/70" : "text-porcelain",
                  )}
                >
                  {item.label}
                </span>
                {!item.ready &&
                  item.envVars.map((name) => (
                    <code
                      key={name}
                      className="rounded bg-ink-800 px-1.5 py-0.5 font-brand-mono text-[10px] text-gold"
                    >
                      {name}
                    </code>
                  ))}
              </div>
              {!item.ready && (
                <p className="mt-1 text-xs leading-relaxed text-graphite">{item.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
