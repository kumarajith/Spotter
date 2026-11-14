import { addDays } from '../common/dates';
import { Db } from '../db/db';
import { StreakRepository } from '../tracking/streak.repository';
import { DynamoService } from './dynamodb.service';
import { ImportSummary, importLegacyData, scanLegacyTable } from './import-dynamo';

/**
 * Temporary, for the v4 cutover: the on-demand sanity check.
 *
 * The app stops writing to DynamoDB at the switch, so the table is a frozen
 * record of everything up to that moment. The question is therefore
 * one-directional: is everything DynamoDB holds also in SQL?
 *
 *  1. Re-runs the copy (DynamoDB -> SQL), so nothing written around the switch is missed.
 *  2. Lists anything in DynamoDB that is still not in SQL — there should be nothing.
 *     Rows that exist only in SQL are activity since the switch, and are just counted.
 *  3. Puts each user's streak as stored in DynamoDB next to the one now derived
 *     from the logs. The stored rows are as of the switch, so this is only
 *     meaningful shortly after it.
 */

const MAX_LISTED = 50;

export interface RowCheck {
  dynamo: number;
  sql: number;
  /** In DynamoDB but not in SQL. Should be 0. */
  missingFromSqlCount: number;
  /** First 50 of those, as "guild | ..." keys. */
  missingFromSql: string[];
  /** In SQL but not in DynamoDB: written since the switch. Expected to grow. */
  newInSqlCount: number;
}

export interface StreakDifference {
  guildId: string;
  userId: string;
  stored: { current: number; best: number };
  derived: { current: number; best: number };
}

export interface VerifyReport {
  /** True when nothing that DynamoDB holds is missing from SQL. */
  ok: boolean;
  today: string;
  copy: ImportSummary;
  rows: { logs: RowCheck; activities: RowCheck; channels: RowCheck };
  streaks: { compared: number; differences: StreakDifference[] };
}

function check(dynamoKeys: string[], sqlKeys: string[]): RowCheck {
  const inDynamo = new Set(dynamoKeys);
  const inSql = new Set(sqlKeys);
  const missingFromSql = [...inDynamo].filter((k) => !inSql.has(k)).sort();
  return {
    dynamo: inDynamo.size,
    sql: inSql.size,
    missingFromSqlCount: missingFromSql.length,
    missingFromSql: missingFromSql.slice(0, MAX_LISTED),
    newInSqlCount: [...inSql].filter((k) => !inDynamo.has(k)).length,
  };
}

export async function verifyAgainstLegacy(
  db: Db,
  dynamo: DynamoService,
  today: string,
): Promise<VerifyReport> {
  const legacy = await scanLegacyTable(dynamo);
  const copy = await importLegacyData(db, legacy);

  const sqlLogs = await db.query<{ key: string }>(
    `SELECT guild_id || ' | ' || user_id || ' | ' || CAST(log_date AS text) || ' | ' || activity_name
              AS key
     FROM activity_logs`,
  );
  // Activities removed since the switch still count as present (they are soft-deleted),
  // and a channel is the same channel whichever panel message it currently points at.
  const sqlActivities = await db.query<{ key: string }>(
    `SELECT guild_id || ' | ' || name AS key FROM activities`,
  );
  const sqlChannels = await db.query<{ key: string }>(
    `SELECT guild_id || ' | ' || channel_id AS key FROM tracked_channels`,
  );

  const rows = {
    logs: check(
      legacy.logs.map((l) => `${l.guildId} | ${l.userId} | ${l.date} | ${l.activityName}`),
      sqlLogs.map((r) => r.key),
    ),
    activities: check(
      legacy.activities.map((a) => `${a.guildId} | ${a.name}`),
      sqlActivities.map((r) => r.key),
    ),
    channels: check(
      legacy.channels.map((c) => `${c.guildId} | ${c.channelId}`),
      sqlChannels.map((r) => r.key),
    ),
  };

  // Streaks: what the old rows say (a stored streak older than yesterday counts
  // as 0 — the nightly reset would have zeroed it) against what the view derives.
  const streakRepository = new StreakRepository(db);
  const yesterday = addDays(today, -1);
  const differences: StreakDifference[] = [];
  for (const guildId of new Set(legacy.streaks.map((s) => s.guildId))) {
    const derived = new Map(
      (await streakRepository.getGuildStreaks(guildId, today)).map((s) => [s.userId, s]),
    );
    for (const stored of legacy.streaks.filter((s) => s.guildId === guildId)) {
      const storedCurrent = stored.lastLoggedDate >= yesterday ? stored.currentStreak : 0;
      const now = derived.get(stored.userId);
      const derivedCurrent = now?.currentStreak ?? 0;
      const derivedBest = now?.bestStreak ?? 0;
      if (storedCurrent !== derivedCurrent || stored.longestStreak !== derivedBest) {
        differences.push({
          guildId,
          userId: stored.userId,
          stored: { current: storedCurrent, best: stored.longestStreak },
          derived: { current: derivedCurrent, best: derivedBest },
        });
      }
    }
  }

  return {
    ok:
      rows.logs.missingFromSqlCount === 0 &&
      rows.activities.missingFromSqlCount === 0 &&
      rows.channels.missingFromSqlCount === 0 &&
      copy.unrecognised.length === 0,
    today,
    copy,
    rows,
    streaks: { compared: legacy.streaks.length, differences },
  };
}
