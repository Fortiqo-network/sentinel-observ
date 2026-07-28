import { Panel } from "@/components/ui/Panel";
import { StatusDot } from "@/components/ui/StatusDot";
import type { MoneySnapshot } from "@/lib/money";
import { formatDuration, formatUtc } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

/**
 * Is money still moving?
 *
 * Given its own panel rather than a row in the service grid, because it answers
 * a question service health cannot: every process can be up while nobody is
 * billed and no seller is paid. Treating it as "just another service" would let
 * a green grid hide a revenue outage.
 */
export function MoneyPathPanel({
  snapshot,
  now,
}: {
  snapshot: MoneySnapshot | null;
  now: Date;
}): React.JSX.Element {
  if (!snapshot) {
    return (
      <Panel eyebrow="Revenue" title="Money path">
        <p className="text-sm leading-relaxed text-graphite">
          Not checked yet. Money-path monitoring rides the gateway aggregate, so it starts
          reporting once <code className="text-gold">GATEWAY_URL</code> and{" "}
          <code className="text-gold">MONITOR_TOKEN</code> are set and a tick has run.
        </p>
      </Panel>
    );
  }

  const { payload } = snapshot;
  const metering = payload.metering;
  const settlements = payload.settlements;
  const status = !snapshot.reachable ? "unknown" : snapshot.ok ? "up" : "down";
  const age = Math.max(0, (now.getTime() - new Date(snapshot.checked_at).getTime()) / 1000);

  return (
    <Panel
      eyebrow="Revenue"
      title="Money path"
      action={
        <span className="font-brand-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
          {formatDuration(age)} ago
        </span>
      }
    >
      <div className="flex items-start gap-2.5">
        <StatusDot status={status} className="mt-1" />
        <p
          className={cn(
            "text-sm leading-relaxed",
            snapshot.ok ? "text-porcelain/80" : "text-status-down",
          )}
        >
          {snapshot.summary}
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-porcelain/[0.07] pt-4">
        <div>
          <dt className="eyebrow">Metering backlog</dt>
          <dd className="metric mt-1 text-sm text-porcelain">
            {metering ? metering.pending.toLocaleString("en-US") : "—"}
            {metering && (
              <span className="ml-1.5 text-xs text-graphite">
                of {metering.stream_length.toLocaleString("en-US")}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Consumers</dt>
          <dd className="metric mt-1 text-sm text-porcelain">
            {metering ? metering.consumers : "—"}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Funds held</dt>
          <dd className="metric mt-1 text-sm text-porcelain">
            {settlements ? settlements.held_units.toLocaleString("en-US") : "—"}
            {settlements && (
              <span className="ml-1.5 text-xs text-graphite">
                across {settlements.held_rows}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Stranded</dt>
          <dd
            className={cn(
              "metric mt-1 text-sm",
              settlements && settlements.stuck_reserved > 0
                ? "text-status-down"
                : "text-porcelain",
            )}
          >
            {settlements
              ? settlements.stuck_reserved +
                settlements.stuck_delivered +
                settlements.stuck_confirmed
              : "—"}
          </dd>
        </div>
      </dl>

      {settlements && Object.keys(settlements.by_state).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-porcelain/[0.07] pt-3">
          {Object.entries(settlements.by_state).map(([state, count]) => (
            <span key={state} className="font-brand-mono text-[11px] text-graphite">
              {state} <span className="text-porcelain/80">{count}</span>
            </span>
          ))}
        </div>
      )}

      <p className="mt-3 font-brand-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
        checked {formatUtc(new Date(snapshot.checked_at))}
      </p>
    </Panel>
  );
}
