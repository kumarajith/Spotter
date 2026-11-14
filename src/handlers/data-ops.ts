import { todayUtc } from '../common/dates';
import { withRetry } from '../common/retry';
import { createDb, Db } from '../db/db';
import { runMigrations } from '../db/migrate';
import { DynamoService } from '../legacy/dynamodb.service';
import { importLegacyData, scanLegacyTable } from '../legacy/import-dynamo';
import { verifyAgainstLegacy } from '../legacy/verify';

/**
 * Operational Lambdas, one export per function.
 *
 *  migrate      — runs on every deploy, before the app Lambdas update. Permanent.
 *  importLegacy — copies DynamoDB -> SQL; runs on deploy before and after the switch.
 *  verify       — on demand: re-copy, then check nothing in DynamoDB is missing (npm run verify).
 *
 * The last two are temporary and go away when the DynamoDB table is removed.
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

export const importLegacy = async () => {
  const summary = await importLegacyData(getDb(), await scanLegacyTable(new DynamoService()));
  console.log('[importLegacy]', JSON.stringify(summary));
  return summary;
};

export const verify = async () => {
  const report = await verifyAgainstLegacy(getDb(), new DynamoService(), todayUtc());
  console.log('[verify]', JSON.stringify(report));
  return report;
};
