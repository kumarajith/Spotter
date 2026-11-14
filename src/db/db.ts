import { Pool } from 'pg';
import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import { withRetry } from '../common/retry';

export type Row = Record<string, unknown>;

/**
 * The only database surface the app uses: one statement in, rows out.
 * Every statement in this codebase is idempotent (inserts use ON CONFLICT,
 * updates set absolute values), which is what makes blanket retries safe.
 */
export interface Db {
  query<R extends Row = Row>(text: string, params?: unknown[]): Promise<R[]>;
  end(): Promise<void>;
}

/** SQLSTATE 40001 — Aurora DSQL reports optimistic-concurrency conflicts this way. */
const SERIALIZATION_FAILURE = '40001';
const NETWORK_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT']);
const DROPPED_CONNECTION = /Connection terminated|connection error|Connection ended/i;

export function isRetryableDbError(err: unknown): boolean {
  const { code, message } = (err ?? {}) as { code?: string; message?: string };
  if (code === SERIALIZATION_FAILURE) return true;
  if (code && NETWORK_CODES.has(code)) return true;
  return DROPPED_CONNECTION.test(message ?? '');
}

export class PgDb implements Db {
  constructor(private readonly pool: Pool) {
    // A pooled client whose socket died while idle (Lambda freeze, DSQL's 1-hour
    // connection limit) emits 'error' on the pool; unhandled, that kills the process.
    pool.on('error', (err) => console.warn('[db] idle connection dropped:', err.message));
  }

  async query<R extends Row = Row>(text: string, params: unknown[] = []): Promise<R[]> {
    const result = await withRetry(() => this.pool.query(text, params), {
      shouldRetry: isRetryableDbError,
    });
    return result.rows as R[];
  }

  end(): Promise<void> {
    return this.pool.end();
  }
}

/**
 * Picks the database from the environment:
 *  - DSQL_ENDPOINT → Aurora DSQL with IAM auth (deployed Lambdas)
 *  - DATABASE_URL  → any plain Postgres
 *  - PGLITE_DIR    → in-process Postgres stored in that folder (local dev, no Docker)
 */
export function createDb(): Db {
  const { DSQL_ENDPOINT, DATABASE_URL, PGLITE_DIR } = process.env;

  if (DSQL_ENDPOINT) {
    // The connector signs a fresh IAM token per connection and already defaults
    // maxLifetimeSeconds below DSQL's 1-hour limit. One connection is enough:
    // a Lambda instance handles one request at a time.
    return new PgDb(
      new AuroraDSQLPool({
        host: DSQL_ENDPOINT,
        user: 'admin',
        max: 1,
        // Fail fast instead of hanging until the Lambda times out.
        connectionTimeoutMillis: 5000,
      }),
    );
  }

  if (DATABASE_URL) {
    return new PgDb(new Pool({ connectionString: DATABASE_URL, max: 1 }));
  }

  if (PGLITE_DIR) {
    // Loaded lazily so the PGlite dev dependency never ends up on the Lambda cold-start path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PgliteDb } = require('./pglite') as typeof import('./pglite');
    return new PgliteDb(PGLITE_DIR);
  }

  throw new Error('One of DSQL_ENDPOINT, DATABASE_URL or PGLITE_DIR is required');
}
