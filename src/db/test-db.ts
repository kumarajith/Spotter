import { randomUUID } from 'node:crypto';
import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import { Db, PgDb } from './db';
import { runMigrations } from './migrate';
import { PgliteDb } from './pglite';

/**
 * A migrated database for specs.
 *
 * Default: a fresh in-memory PGlite per call. Set TEST_DSQL_ENDPOINT to run the
 * same specs against a real Aurora DSQL cluster instead (needs AWS credentials);
 * that is how Postgres/DSQL differences get caught.
 */
export async function createTestDb(): Promise<Db> {
  const endpoint = process.env.TEST_DSQL_ENDPOINT;
  const db: Db = endpoint
    ? new PgDb(new AuroraDSQLPool({ host: endpoint, user: 'admin', max: 1 }))
    : new PgliteDb();
  await runMigrations(db);
  return db;
}

/**
 * Specs never clean up (DSQL has no TRUNCATE, and a shared cluster may hold
 * other data); each one works in its own guild instead.
 */
export function uniqueGuildId(): string {
  return `test-${randomUUID()}`;
}
