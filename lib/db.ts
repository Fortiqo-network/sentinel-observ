import { Pool, type QueryResultRow } from "pg";

/**
 * Postgres access.
 *
 * The database is optional by design: with `DATABASE_URL` unset the app still
 * builds, deploys and serves a live-probe-only dashboard. Every caller must
 * check {@link hasDatabase} (or handle a null pool) rather than assuming
 * persistence exists — that is what keeps a first deploy useful before the
 * Neon database is provisioned.
 */

let pool: Pool | null = null;

/** True when a database is configured and history/alerting can be persisted. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Return the shared connection pool, creating it on first use.
 *
 * Serverless functions are short-lived, so the pool is deliberately small and
 * given a short idle timeout: a large pool on Vercel exhausts Postgres
 * connection slots across concurrent invocations.
 */
export function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      ssl: url.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

/** Run a parameterized query and return its rows. */
export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

/** Run a query returning at most one row, or null. */
export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Execute `fn` inside a transaction, rolling back on any error.
 *
 * The tick handler uses this so a partial write can never leave an incident row
 * without its matching service_state update.
 */
export async function transaction<T>(
  fn: (run: <R extends QueryResultRow>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(async <R extends QueryResultRow>(text: string, params: unknown[] = []) => {
      const res = await client.query<R>(text, params);
      return res.rows;
    });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
