import { todayUtc } from '../common/dates';
import { withRetry } from '../common/retry';
import { createDb, Db } from '../db/db';
import { runMigrations } from '../db/migrate';
import { DynamoService } from '../legacy/dynamodb.service';
import { importLegacyData, scanLegacyTable } from '../legacy/import-dynamo';
import { StreakRepository as DynamoStreakRepository } from '../legacy/streak.repository';
import { StreakService as DynamoStreakService } from '../legacy/streak.service';
import { verifyAgainstLegacy } from '../legacy/verify';

/**
 * Operational Lambdas, one export per function.
 *
 *  migrate                — runs on every deploy, before the app Lambdas update. Permanent.
 *  importLegacy           — copies DynamoDB -> SQL; runs on deploy before and after the switch.
 *  verify                 — on demand: re-copy, then compare both stores (npm run verify).
 *  recomputeLegacyStreaks — on demand, only before rolling back to the DynamoDB code.
 *
 * The last three are temporary and go away when DynamoDB is retired.
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

/**
 * Rollback preparation. After the switch the DynamoDB logs are kept current by
 * the mirror, but the stored streak rows are not. This rebuilds them from the
 * logs with the old algorithm, so the pre-v4 code can be redeployed as-is.
 */
export const recomputeLegacyStreaks = async () => {
  const dynamo = new DynamoService();
  const streakService = new DynamoStreakService(new DynamoStreakRepository(dynamo));

  const { logs } = await scanLegacyTable(dynamo);
  const users = new Map(logs.map((log) => [`${log.guildId}|${log.userId}`, log]));
  for (const { guildId, userId } of users.values()) {
    await streakService.recomputeStreak(guildId, userId);
  }

  console.log(`[recomputeLegacyStreaks] recomputed ${users.size} users`);
  return { recomputed: users.size };
};
