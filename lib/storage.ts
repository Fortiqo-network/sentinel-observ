import { query } from "./db";

/**
 * Storage budget enforcement.
 *
 * The database is a Neon free tier with a hard 500 MB ceiling, and the app is
 * the only writer, so staying under the limit is entirely our problem. Two
 * tables grow without bound: `checks` grows with time (a predictable ~2k
 * rows/day) and `pageviews` grows with traffic (unpredictable — a launch or a
 * crawler can multiply it overnight). That second one is the real risk.
 *
 * The strategy is aggregate-then-prune, not prune-alone: daily rollups are
 * written before raw rows are deleted, so tightening retention costs detail but
 * never history. Uptime percentages and visit counts stay correct at any
 * retention level.
 *
 * Retention tightens automatically as usage climbs, so the ceiling is enforced
 * by the system rather than by somebody remembering to check a dashboard.
 */

const MB = 1024 * 1024;

/** Usable ceiling in bytes. Neon free is 500 MB; override with STORAGE_LIMIT_MB. */
export function storageLimitBytes(): number {
  const configured = Number(process.env.STORAGE_LIMIT_MB);
  return (Number.isFinite(configured) && configured > 0 ? configured : 500) * MB;
}

export type TableUsage = { table: string; bytes: number; rows: number };

export type StorageUsage = {
  totalBytes: number;
  limitBytes: number;
  usedPct: number;
  tables: TableUsage[];
  tier: RetentionTier;
};

/**
 * Retention windows, in days, per pressure tier.
 *
 * `raw` figures only affect how much detail is queryable; the rollup tables are
 * never pruned, so long-range uptime and traffic charts are unaffected.
 */
export type RetentionTier = {
  name: "normal" | "reduced" | "tight" | "emergency";
  atPct: number;
  checks: number;
  pageviewsRaw: number;
  monitorRuns: number;
};

const TIERS: RetentionTier[] = [
  { name: "normal", atPct: 0, checks: 90, pageviewsRaw: 180, monitorRuns: 180 },
  { name: "reduced", atPct: 60, checks: 45, pageviewsRaw: 90, monitorRuns: 90 },
  { name: "tight", atPct: 80, checks: 21, pageviewsRaw: 45, monitorRuns: 45 },
  { name: "emergency", atPct: 92, checks: 7, pageviewsRaw: 14, monitorRuns: 14 },
];

export function tierFor(usedPct: number): RetentionTier {
  return [...TIERS].reverse().find((t) => usedPct >= t.atPct) ?? TIERS[0];
}

/** Measure current database size and the per-table breakdown. */
export async function getStorageUsage(): Promise<StorageUsage> {
  const [{ total }] = await query<{ total: string }>(
    `SELECT pg_database_size(current_database())::bigint::text AS total`,
  );
  const rows = await query<{ table: string; bytes: string; rows: string }>(
    `SELECT c.relname AS table,
            pg_total_relation_size(c.oid)::bigint::text AS bytes,
            COALESCE(s.n_live_tup, 0)::bigint::text AS rows
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY pg_total_relation_size(c.oid) DESC`,
  );

  const totalBytes = Number(total);
  const limitBytes = storageLimitBytes();
  const usedPct = (totalBytes / limitBytes) * 100;

  return {
    totalBytes,
    limitBytes,
    usedPct,
    tables: rows.map((r) => ({ table: r.table, bytes: Number(r.bytes), rows: Number(r.rows) })),
    tier: tierFor(usedPct),
  };
}

/**
 * Fold raw pageviews older than `keepDays` into `pageview_daily`, then delete
 * them. Idempotent — re-running adds nothing, because the rows it aggregated
 * are gone and the upsert is keyed on (day, path).
 */
async function rollUpPageviews(keepDays: number): Promise<number> {
  const rows = await query<{ moved: number }>(
    `WITH cutoff AS (SELECT now() - ($1::int * INTERVAL '1 day') AS at),
     aggregated AS (
       SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day, path, COUNT(*)::int AS views
       FROM pageviews, cutoff
       WHERE occurred_at < cutoff.at
       GROUP BY 1, 2
     ), upserted AS (
       INSERT INTO pageview_daily (day, path, views)
       SELECT day, path, views FROM aggregated
       ON CONFLICT (day, path) DO UPDATE SET views = pageview_daily.views + EXCLUDED.views
       RETURNING 1
     ), deleted AS (
       DELETE FROM pageviews USING cutoff WHERE occurred_at < cutoff.at RETURNING 1
     )
     SELECT (SELECT COUNT(*) FROM deleted)::int AS moved`,
    [keepDays],
  );
  return rows[0]?.moved ?? 0;
}

async function pruneTable(table: string, column: string, keepDays: number): Promise<number> {
  const rows = await query<{ removed: number }>(
    `WITH deleted AS (
       DELETE FROM ${table} WHERE ${column} < now() - ($1::int * INTERVAL '1 day') RETURNING 1
     ) SELECT COUNT(*)::int AS removed FROM deleted`,
    [keepDays],
  );
  return rows[0]?.removed ?? 0;
}

export type EnforcementResult = {
  before: StorageUsage;
  after: StorageUsage;
  tier: RetentionTier;
  pageviewsRolledUp: number;
  checksPruned: number;
  runsPruned: number;
  /** True when usage is still above the tightest tier after pruning. */
  stillOverBudget: boolean;
};

/**
 * Apply the retention tier matching current usage, then re-measure.
 *
 * Runs `VACUUM` afterwards: without it, deleted rows leave dead tuples that
 * still occupy pages, so the space would not actually come back and the next
 * run would prune even harder for no reason.
 */
export async function enforceStorageBudget(): Promise<EnforcementResult> {
  const before = await getStorageUsage();
  const tier = before.tier;

  const pageviewsRolledUp = await rollUpPageviews(tier.pageviewsRaw);
  const checksPruned = await pruneTable("checks", "checked_at", tier.checks);
  const runsPruned = await pruneTable("monitor_runs", "ran_at", tier.monitorRuns);
  await pruneTable("money_health", "checked_at", tier.monitorRuns);

  if (pageviewsRolledUp + checksPruned + runsPruned > 0) {
    await query("VACUUM (ANALYZE) checks, pageviews, monitor_runs, money_health");
  }

  const after = await getStorageUsage();
  return {
    before,
    after,
    tier,
    pageviewsRolledUp,
    checksPruned,
    runsPruned,
    stillOverBudget: after.usedPct >= TIERS[TIERS.length - 1].atPct,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
