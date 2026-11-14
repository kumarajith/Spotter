import { Db } from './db';
import { MIGRATIONS } from './migrations';

export interface Migration {
  id: string;
  /**
   * Aurora DSQL allows one DDL statement per transaction and never DDL and DML
   * together, so a migration cannot be atomic. Each statement runs on its own
   * and must be safe to run again (IF NOT EXISTS / OR REPLACE): a migration
   * that failed halfway is simply re-run from its first statement.
   */
  statements: string[];
}

/** Applies pending migrations in order. Returns the ids applied in this run. */
export async function runMigrations(
  db: Db,
  migrations: Migration[] = MIGRATIONS,
): Promise<string[]> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id         text        PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const rows = await db.query<{ id: string }>('SELECT id FROM schema_migrations');
  const done = new Set(rows.map((r) => r.id));

  const applied: string[] = [];
  for (const migration of migrations) {
    if (done.has(migration.id)) continue;

    for (const statement of migration.statements) {
      await db.query(statement);
    }
    await db.query('INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [
      migration.id,
    ]);
    applied.push(migration.id);
  }
  return applied;
}
