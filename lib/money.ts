import { hasDatabase, query, queryOne } from "./db";

/**
 * Money-path monitoring.
 *
 * Service health answers "is the process running?" — which every service passes
 * while money silently stops moving. Two failures are invisible to it:
 *
 *   - the metering consumer dies: calls execute, nobody is billed, the signed
 *     audit stream grows forever;
 *   - the settlement reaper stalls: buyer funds stay held and sellers are never
 *     paid, and because the reserve path is fail-closed this looks healthy right
 *     up until someone's balance is wrong.
 *
 * Billing computes both (`/v1/ops/money-health`); the gateway relays them. This
 * module fetches, persists and decides when to alert.
 *
 * Alerts fire on *transition*, exactly like service outages: a permanently
 * unhappy money path must not post every five minutes.
 */

export type MoneyHealth = {
  ok: boolean;
  reachable: boolean;
  error?: string | null;
  metering?: {
    stream_length: number;
    pending: number;
    oldest_pending_ms: number | null;
    consumers: number;
    ok: boolean;
    error?: string | null;
  };
  settlements?: {
    by_state: Record<string, number>;
    held_rows: number;
    held_units: number;
    stuck_reserved: number;
    stuck_delivered: number;
    stuck_confirmed: number;
    oldest_held_age_secs: number | null;
    ok: boolean;
  };
  reconciliation?: { ok: boolean; drift_units?: number; anomalies?: string[] } | null;
};

const TIMEOUT_MS = 15_000;

/** True when the gateway aggregate is configured; money health rides the same route. */
export function isMoneyMonitoringConfigured(): boolean {
  return Boolean(process.env.GATEWAY_URL && process.env.MONITOR_TOKEN);
}

/**
 * Fetch money-path health through the gateway.
 *
 * `reachable: false` means we could not ask, which is deliberately different
 * from `ok: false`, which means billing answered and something is wrong.
 */
export async function fetchMoneyHealth(deep = false): Promise<MoneyHealth | null> {
  const gatewayUrl = process.env.GATEWAY_URL;
  const token = process.env.MONITOR_TOKEN;
  if (!gatewayUrl || !token) return null;

  try {
    const res = await fetch(
      `${gatewayUrl.replace(/\/$/, "")}/internal/monitor/money${deep ? "?deep=true" : ""}`,
      {
        headers: { "X-Monitor-Token": token },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return { ok: false, reachable: false, error: `gateway returned HTTP ${res.status}` };
    }
    return (await res.json()) as MoneyHealth;
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type MoneySnapshot = {
  checked_at: Date;
  ok: boolean;
  reachable: boolean;
  summary: string;
  payload: MoneyHealth;
};

/** Persist the latest snapshot. One row is kept per check, pruned with the rest. */
export async function recordMoneyHealth(health: MoneyHealth, at: Date): Promise<void> {
  await query(
    `INSERT INTO money_health (checked_at, ok, reachable, summary, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [at, health.ok, health.reachable !== false, summarize(health), JSON.stringify(health)],
  );
}

export async function getLatestMoneyHealth(): Promise<MoneySnapshot | null> {
  if (!hasDatabase()) return null;
  const row = await queryOne<{
    checked_at: Date;
    ok: boolean;
    reachable: boolean;
    summary: string;
    payload: MoneyHealth;
  }>(
    `SELECT checked_at, ok, reachable, summary, payload
     FROM money_health ORDER BY checked_at DESC LIMIT 1`,
  );
  return row ? { ...row, payload: row.payload } : null;
}

/** The state of the previous check, used to detect a transition. */
export async function getPreviousMoneyOk(before: Date): Promise<boolean | null> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT ok FROM money_health WHERE checked_at < $1 ORDER BY checked_at DESC LIMIT 1`,
    [before],
  );
  return row ? row.ok : null;
}

/** Drop money-health rows older than the retention window. */
export async function pruneMoneyHealth(retentionDays: number): Promise<number> {
  const rows = await query<{ removed: number }>(
    `WITH deleted AS (
       DELETE FROM money_health WHERE checked_at < now() - ($1::int * INTERVAL '1 day') RETURNING 1
     ) SELECT COUNT(*)::int AS removed FROM deleted`,
    [retentionDays],
  );
  return rows[0]?.removed ?? 0;
}

/** One human-readable line naming what is wrong, or confirming all is well. */
export function summarize(health: MoneyHealth): string {
  if (health.reachable === false) {
    return `cannot reach billing: ${health.error ?? "unknown error"}`;
  }
  if (health.ok) return "metering draining, no stranded settlements";

  const problems: string[] = [];
  const m = health.metering;
  const s = health.settlements;

  if (m && !m.ok) {
    const idleMin = m.oldest_pending_ms ? Math.round(m.oldest_pending_ms / 60000) : null;
    problems.push(
      m.error
        ? `metering unreadable (${m.error})`
        : `metering backlog: ${m.pending.toLocaleString("en-US")} unacked events, oldest ${idleMin ?? "?"} min — the billing consumer is not draining`,
    );
  }
  if (s && !s.ok) {
    if (s.stuck_reserved > 0) {
      problems.push(
        `${s.stuck_reserved} reserve${s.stuck_reserved === 1 ? "" : "s"} past TTL — buyer funds held, seller unpaid (reaper not running)`,
      );
    }
    if (s.stuck_delivered > 0) {
      problems.push(`${s.stuck_delivered} delivered call(s) never confirmed`);
    }
    if (s.stuck_confirmed > 0) {
      problems.push(`${s.stuck_confirmed} confirmed call(s) never settled`);
    }
  }
  if (health.reconciliation && !health.reconciliation.ok) {
    problems.push(
      `ledger drift of ${health.reconciliation.drift_units ?? "?"} units` +
        (health.reconciliation.anomalies?.length
          ? ` (${health.reconciliation.anomalies.length} anomalies)`
          : ""),
    );
  }

  return problems.length ? problems.join(" · ") : "money path reported unhealthy";
}
