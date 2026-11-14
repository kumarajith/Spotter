import { Db } from '../db/db';
import { DynamoService } from './dynamodb.service';

/**
 * Temporary, for the v4 cutover: copies everything in the old DynamoDB table
 * into the SQL database. Additive and idempotent — it only inserts rows that
 * are missing, so it can be run any number of times, before or after the switch.
 */

export interface LegacyLog {
  guildId: string;
  userId: string;
  date: string;
  activityName: string;
  loggedAt?: string;
}

export interface LegacyActivity {
  guildId: string;
  name: string;
  displayName: string;
  emoji: string;
  isDefault: boolean;
  createdBy: string;
  createdAt?: string;
}

export interface LegacyChannel {
  guildId: string;
  channelId: string;
  lastPanelMessageId?: string;
  createdAt?: string;
}

export interface LegacyStreak {
  guildId: string;
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastLoggedDate: string;
}

export interface LegacyData {
  logs: LegacyLog[];
  activities: LegacyActivity[];
  channels: LegacyChannel[];
  streaks: LegacyStreak[];
  /** "PK | SK" of items this code does not know how to copy. Should be empty. */
  unrecognised: string[];
}

export interface ImportSummary {
  scanned: { logs: number; activities: number; channels: number; streaks: number };
  inserted: { logs: number; activities: number; channels: number; bestStreakFloors: number };
  /** Logs whose date is not a real calendar day; a `date` column cannot hold them. */
  invalidDateLogs: string[];
  unrecognised: string[];
}

const BATCH_SIZE = 500; // Aurora DSQL caps a transaction at 3,000 modified rows

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalStr(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Reads the whole table with strongly consistent, paginated scans.
 * Entities are recognised by their sort-key prefix, and identities are taken
 * from the keys themselves, since those are what DynamoDB enforces as unique.
 */
export async function scanLegacyTable(dynamo: DynamoService): Promise<LegacyData> {
  const data: LegacyData = {
    logs: [],
    activities: [],
    channels: [],
    streaks: [],
    unrecognised: [],
  };
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await dynamo.scan({ ConsistentRead: true, ExclusiveStartKey: lastKey });

    for (const item of page.Items ?? []) {
      const pk = str(item['PK']);
      const sk = str(item['SK']);
      const guildId = pk.startsWith('GUILD#') ? pk.slice('GUILD#'.length) : '';

      if (guildId && sk.startsWith('LOG#')) {
        // LOG#<date>#<userId>#<activityName>
        const [, date, userId, ...activity] = sk.split('#');
        data.logs.push({
          guildId,
          userId,
          date,
          activityName: activity.join('#'),
          loggedAt: optionalStr(item['loggedAt']),
        });
      } else if (guildId && sk.startsWith('ACTIVITY#')) {
        const name = sk.slice('ACTIVITY#'.length);
        data.activities.push({
          guildId,
          name,
          displayName: str(item['displayName'], name),
          emoji: str(item['emoji']),
          isDefault: item['isDefault'] === true,
          createdBy: str(item['createdBy'], 'system'),
          createdAt: optionalStr(item['createdAt']),
        });
      } else if (guildId && sk.startsWith('CHANNEL#')) {
        data.channels.push({
          guildId,
          channelId: sk.slice('CHANNEL#'.length),
          lastPanelMessageId: optionalStr(item['lastPanelMessageId']),
          createdAt: optionalStr(item['createdAt']),
        });
      } else if (guildId && sk.startsWith('STREAK#')) {
        data.streaks.push({
          guildId,
          userId: sk.slice('STREAK#'.length),
          currentStreak: Number(item['currentStreak'] ?? 0),
          longestStreak: Number(item['longestStreak'] ?? 0),
          lastLoggedDate: str(item['lastLoggedDate']),
        });
      } else {
        data.unrecognised.push(`${pk} | ${sk}`);
      }
    }

    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  return data;
}

/** Inserts rows in batches with one multi-row statement each; returns how many were new. */
async function insertMissing(
  db: Db,
  table: string,
  columns: Array<{ name: string; cast?: string }>,
  rows: unknown[][],
): Promise<number> {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const tuples = batch.map((_, r) => {
      const placeholders = columns.map(
        (column, c) => `$${r * columns.length + c + 1}${column.cast ? `::${column.cast}` : ''}`,
      );
      return `(${placeholders.join(', ')})`;
    });
    const result = await db.query(
      `INSERT INTO ${table} (${columns.map((c) => c.name).join(', ')})
       VALUES ${tuples.join(', ')}
       ON CONFLICT DO NOTHING
       RETURNING 1 AS inserted`,
      batch.flat(),
    );
    inserted += result.length;
  }
  return inserted;
}

export async function importLegacyData(db: Db, data: LegacyData): Promise<ImportSummary> {
  const now = new Date().toISOString();

  const validLogs = data.logs.filter((log) => isRealDate(log.date));
  const invalidDateLogs = data.logs
    .filter((log) => !isRealDate(log.date))
    .map((log) => `${log.guildId} | ${log.userId} | ${log.date} | ${log.activityName}`);

  const logs = await insertMissing(
    db,
    'activity_logs',
    [
      { name: 'guild_id' },
      { name: 'user_id' },
      { name: 'log_date', cast: 'date' },
      { name: 'activity_name' },
      { name: 'logged_at', cast: 'timestamptz' },
    ],
    validLogs.map((log) => [
      log.guildId,
      log.userId,
      log.date,
      log.activityName,
      log.loggedAt ?? `${log.date}T00:00:00Z`,
    ]),
  );

  const activities = await insertMissing(
    db,
    'activities',
    [
      { name: 'guild_id' },
      { name: 'name' },
      { name: 'display_name' },
      { name: 'emoji' },
      { name: 'is_default', cast: 'boolean' },
      { name: 'created_by' },
      { name: 'created_at', cast: 'timestamptz' },
    ],
    data.activities.map((a) => [
      a.guildId,
      a.name,
      a.displayName,
      a.emoji,
      a.isDefault,
      a.createdBy,
      a.createdAt ?? now,
    ]),
  );

  const channels = await insertMissing(
    db,
    'tracked_channels',
    [
      { name: 'guild_id' },
      { name: 'channel_id' },
      { name: 'last_panel_message_id' },
      { name: 'created_at', cast: 'timestamptz' },
    ],
    data.channels.map((c) => [
      c.guildId,
      c.channelId,
      c.lastPanelMessageId ?? null,
      c.createdAt ?? now,
    ]),
  );

  // Anyone whose stored best streak is higher than the logs now reproduce keeps it as a floor.
  const derived = await db.query<{ guild_id: string; user_id: string; best: number }>(
    `SELECT guild_id, user_id, CAST(MAX(length) AS integer) AS best
     FROM streak_runs
     GROUP BY guild_id, user_id`,
  );
  const derivedBest = new Map(derived.map((r) => [`${r.guild_id}|${r.user_id}`, r.best]));
  const floors = data.streaks.filter(
    (s) => s.longestStreak > (derivedBest.get(`${s.guildId}|${s.userId}`) ?? 0),
  );
  const bestStreakFloors = await insertMissing(
    db,
    'legacy_best_streaks',
    [{ name: 'guild_id' }, { name: 'user_id' }, { name: 'best_streak', cast: 'integer' }],
    floors.map((s) => [s.guildId, s.userId, s.longestStreak]),
  );

  return {
    scanned: {
      logs: data.logs.length,
      activities: data.activities.length,
      channels: data.channels.length,
      streaks: data.streaks.length,
    },
    inserted: { logs, activities, channels, bestStreakFloors },
    invalidDateLogs,
    unrecognised: data.unrecognised,
  };
}
