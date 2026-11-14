import { addDays } from '../common/dates';
import { Db } from '../db/db';
import { StreakRepository } from '../tracking/streak.repository';
import { DynamoService } from './dynamodb.service';
import { ImportSummary, importLegacyData, scanLegacyTable } from './import-dynamo';

/**
 * Temporary, for the v4 cutover: the on-demand sanity check.
 *
 *  1. Re-runs the copy (DynamoDB -> SQL), so nothing written around the switch is missed.
 *  2. Compares logs, activities and channels row by row between the two stores.
 *  3. Puts each user's streak as stored in DynamoDB next to the one now derived
 *     from the logs. The stored rows stop being updated at the switch, so this
 *     part is only meaningful shortly after it.
 */

const MAX_LISTED = 50;

export interface RowDifference {
  dynamo: number;
  sql: number;
  onlyInDynamoCount: number;
  onlyInSqlCount: number;
  /** First 50 of each, as "guild | ..." keys. */
  onlyInDynamo: string[];
  onlyInSql: string[];
}

export interface StreakDifference {
  guildId: string;
  userId: string;
  stored: { current: number; best: number };
  derived: { current: number; best: number };
}

export interface VerifyReport {
  /** True when logs, activities and channels are identical in both stores. */
  ok: boolean;
  today: string;
  copy: ImportSummary;
  rows: { logs: RowDifference; activities: RowDifference; channels: RowDifference };
  streaks: { compared: number; differences: StreakDifference[] };
}

function compare(dynamoKeys: string[], sqlKeys: string[]): RowDifference {
  const inDynamo = new Set(dynamoKeys);
  const inSql = new Set(sqlKeys);
  const onlyInDynamo = [...inDynamo].filter((k) => !inSql.has(k)).sort();
  const onlyInSql = [...inSql].filter((k) => !inDynamo.has(k)).sort();
  return {
    dynamo: inDynamo.size,
    sql: inSql.size,
    onlyInDynamoCount: onlyInDynamo.length,
    onlyInSqlCount: onlyInSql.length,
    onlyInDynamo: onlyInDynamo.slice(0, MAX_LISTED),
    onlyInSql: onlyInSql.slice(0, MAX_LISTED),
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
  const sqlActivities = await db.query<{ key: string }>(
    `SELECT guild_id || ' | ' || name AS key FROM activities WHERE removed_at IS NULL`,
  );
  const sqlChannels = await db.query<{ key: string }>(
    `SELECT guild_id || ' | ' || channel_id || ' | ' || COALESCE(last_panel_message_id, '') AS key
     FROM tracked_channels`,
  );

  const rows = {
    logs: compare(
      legacy.logs.map((l) => `${l.guildId} | ${l.userId} | ${l.date} | ${l.activityName}`),
      sqlLogs.map((r) => r.key),
    ),
    activities: compare(
      legacy.activities.map((a) => `${a.guildId} | ${a.name}`),
      sqlActivities.map((r) => r.key),
    ),
    channels: compare(
      legacy.channels.map((c) => `${c.guildId} | ${c.channelId} | ${c.lastPanelMessageId ?? ''}`),
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

  const identical = (d: RowDifference) => d.onlyInDynamoCount === 0 && d.onlyInSqlCount === 0;
  return {
    ok:
      identical(rows.logs) &&
      identical(rows.activities) &&
      identical(rows.channels) &&
      copy.unrecognised.length === 0,
    today,
    copy,
    rows,
    streaks: { compared: legacy.streaks.length, differences },
  };
}
