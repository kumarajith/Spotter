import { withRetry } from '../common/retry';
import { createDb, Db } from '../db/db';
import { runMigrations } from '../db/migrate';

/**
 * Operational Lambda: `migrate` runs on every deploy, before the app Lambdas
 * receive new code, and applies any pending migrations from src/db/migrations.
 */

let db: Db | undefined;

function getDb(): Db {
  db ??= createDb();
  return db;
}

export const migrate = async () => {
  const database = getDb();
  // On a first deploy the function's IAM policy can take a few seconds to take
  // effect, so the very first connection is given some patience.
  await withRetry(() => database.query('SELECT 1'), { maxAttempts: 6, baseDelayMs: 1000 });

  const applied = await runMigrations(database);
  console.log('[migrate] applied:', applied.length ? applied.join(', ') : 'nothing new');
  return { applied };
};
