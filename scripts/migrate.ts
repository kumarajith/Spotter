/**
 * Migrates data from the legacy SQLite database to DynamoDB.
 *
 * Usage:
 *   npx ts-node scripts/migrate.ts --db <path-to-spotter.db> [options]
 *
 * Options:
 *   --db <path>          Path to the legacy SQLite database (required)
 *   --dry-run            Log what would be written without writing
 *   --table-name <name>  DynamoDB table name (default: TABLE_NAME env or 'spotter-dev')
 *   --endpoint <url>     DynamoDB endpoint (default: DYNAMODB_ENDPOINT env)
 *   --guild <id>         Migrate a single guild (for testing)
 */

import Database from 'better-sqlite3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// ── Types ────────────────────────────────────────────────────────────────────

interface SqliteActivity {
  id: number;
  guild_id: string;
  name: string;
  emoji: string | null;
  is_default: number;
  created_by: string | null;
}

interface SqliteLog {
  guild_id: string;
  user_id: string;
  activity_name: string;
  logged_date: string;
  logged_at: string;
}

interface SqliteChannel {
  guild_id: string;
  channel_id: string;
  last_panel_message_id: string | null;
}

// ── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let dbPath = '';
  let dryRun = false;
  let tableName = process.env.TABLE_NAME ?? 'spotter-dev';
  let endpoint = process.env.DYNAMODB_ENDPOINT;
  let guild: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--db':
        dbPath = args[++i];
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--table-name':
        tableName = args[++i];
        break;
      case '--endpoint':
        endpoint = args[++i];
        break;
      case '--guild':
        guild = args[++i];
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  if (!dbPath) {
    console.error('Missing required --db <path>');
    process.exit(1);
  }

  return { dbPath, dryRun, tableName, endpoint, guild };
}

// ── Streak computation (ported from legacy/src/utils/streakCalc.js) ──────────

const REST_STREAK_LIMIT = 5;
const REST_ACTIVITY = 'rest';

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function padStreak(n: number): string {
  return n.toString().padStart(5, '0');
}

function buildDateMap(logs: SqliteLog[]): Map<string, { hasNonRest: boolean }> {
  const map = new Map<string, { hasNonRest: boolean }>();
  for (const row of logs) {
    if (!map.has(row.logged_date)) {
      map.set(row.logged_date, { hasNonRest: false });
    }
    if (row.activity_name.toLowerCase() !== REST_ACTIVITY) {
      map.get(row.logged_date)!.hasNonRest = true;
    }
  }
  return map;
}

function countRun(dates: string[], dateMap: Map<string, { hasNonRest: boolean }>): number {
  let streak = 0;
  let consecutiveRest = 0;

  for (const date of dates) {
    const info = dateMap.get(date);
    if (!info) break;

    if (info.hasNonRest) {
      consecutiveRest = 0;
    } else {
      consecutiveRest++;
      if (consecutiveRest >= REST_STREAK_LIMIT) {
        streak = Math.max(0, streak - (consecutiveRest - 1));
        break;
      }
    }
    streak++;
  }

  return streak;
}

function computeStreak(logs: SqliteLog[]): {
  currentStreak: number;
  longestStreak: number;
  lastLoggedDate: string;
  consecutiveRestOnlyDays: number;
  lastDayHasNonRest: boolean;
} {
  if (logs.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      lastLoggedDate: '',
      consecutiveRestOnlyDays: 0,
      lastDayHasNonRest: false,
    };
  }

  const dateMap = buildDateMap(logs);
  // Unique dates DESC
  const allDates = [...new Set(logs.map((r) => r.logged_date))].sort().reverse();

  // Use UTC explicitly so streak computation is consistent regardless of where the script runs
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = addDays(today, -1);

  // Current streak (anchored to today/yesterday)
  let currentStreak = 0;
  if (allDates[0] === today || allDates[0] === yesterday) {
    const consecutive: string[] = [allDates[0]];
    for (let i = 1; i < allDates.length; i++) {
      if (allDates[i] === addDays(allDates[i - 1], -1)) {
        consecutive.push(allDates[i]);
      } else {
        break;
      }
    }
    currentStreak = countRun(consecutive, dateMap);
  }

  // Best streak across all runs
  let bestStreak = 0;
  let runStart = 0;
  while (runStart < allDates.length) {
    const consecutive: string[] = [allDates[runStart]];
    for (let i = runStart + 1; i < allDates.length; i++) {
      if (allDates[i] === addDays(allDates[i - 1], -1)) {
        consecutive.push(allDates[i]);
      } else {
        break;
      }
    }
    const run = countRun(consecutive, dateMap);
    if (run > bestStreak) bestStreak = run;
    runStart += consecutive.length;
  }

  const longestStreak = Math.max(currentStreak, bestStreak);

  // Derive incremental state from trailing dates
  const lastDayHasNonRest = dateMap.get(allDates[0])?.hasNonRest ?? false;
  let consecutiveRestOnlyDays = 0;
  for (let i = 0; i < currentStreak && i < allDates.length; i++) {
    const info = dateMap.get(allDates[i]);
    if (info?.hasNonRest) break;
    consecutiveRestOnlyDays++;
  }

  return {
    currentStreak,
    longestStreak,
    lastLoggedDate: allDates[0],
    consecutiveRestOnlyDays,
    lastDayHasNonRest,
  };
}

// ── DynamoDB batch writer ────────────────────────────────────────────────────

async function batchWrite(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  items: Record<string, unknown>[],
  dryRun: boolean,
  label: string,
): Promise<number> {
  if (items.length === 0) return 0;

  if (dryRun) {
    console.log(`  [DRY RUN] Would write ${items.length} ${label} items`);
    return items.length;
  }

  // DynamoDB batch write limit is 25 items
  let written = 0;
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    let requests = chunk.map((item) => ({ PutRequest: { Item: item } }));

    // Retry loop for unprocessed items (DynamoDB throttling)
    let attempt = 0;
    while (requests.length > 0) {
      if (attempt > 0) {
        const backoff = Math.min(1000 * 2 ** attempt, 30_000);
        console.log(
          `  Retrying ${requests.length} unprocessed ${label} items (attempt ${attempt}, backoff ${backoff}ms)`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }

      const result = await docClient.send(
        new BatchWriteCommand({
          RequestItems: { [tableName]: requests },
        }),
      );

      const unprocessed = result.UnprocessedItems?.[tableName] ?? [];
      written += requests.length - unprocessed.length;
      requests = unprocessed as typeof requests;
      attempt++;

      if (attempt > 8 && requests.length > 0) {
        throw new Error(
          `Failed to write ${requests.length} ${label} items after ${attempt} retries`,
        );
      }
    }
  }

  console.log(`  Wrote ${written} ${label} items`);
  return written;
}

// ── Main migration ───────────────────────────────────────────────────────────

async function migrate() {
  const { dbPath, dryRun, tableName, endpoint, guild } = parseArgs(process.argv);

  console.log('=== Spotter Migration: SQLite → DynamoDB ===');
  console.log(`  DB:         ${dbPath}`);
  console.log(`  Table:      ${tableName}`);
  console.log(`  Endpoint:   ${endpoint ?? '(default AWS)'}`);
  console.log(`  Guild:      ${guild ?? '(all)'}`);
  console.log(`  Dry run:    ${dryRun}`);
  console.log('');

  // Open SQLite
  const db = new Database(dbPath, { readonly: true });

  // Setup DynamoDB client
  const dynamoClient = new DynamoDBClient({
    ...(endpoint && { endpoint }),
    region: process.env.AWS_REGION ?? 'ap-south-1',
  });
  const docClient = DynamoDBDocumentClient.from(dynamoClient);

  const guildFilter = guild ? `WHERE guild_id = ?` : '';
  const guildFilterAliased = guild ? `WHERE al.guild_id = ?` : '';
  const guildParams = guild ? [guild] : [];

  const now = new Date().toISOString();
  let totalActivities = 0;
  let totalLogs = 0;
  let totalChannels = 0;
  let totalStreaks = 0;

  try {
    // ── 1. Activities ────────────────────────────────────────────────────────

    console.log('1. Migrating activities...');
    const activities = db
      .prepare(`SELECT * FROM activities ${guildFilter}`)
      .all(...guildParams) as SqliteActivity[];

    const activityItems = activities.map((a) => ({
      PK: `GUILD#${a.guild_id}`,
      SK: `ACTIVITY#${a.name.toLowerCase()}`,
      displayName: a.name,
      emoji: a.emoji ?? '',
      isDefault: a.is_default === 1,
      createdBy: a.created_by ?? 'system',
      createdAt: now,
      entityType: 'ACTIVITY',
    }));

    totalActivities = await batchWrite(docClient, tableName, activityItems, dryRun, 'activity');

    // ── 2. Activity logs ─────────────────────────────────────────────────────

    console.log('2. Migrating activity logs...');
    const logs = db
      .prepare(
        `SELECT al.guild_id, al.user_id, a.name AS activity_name, al.logged_date, al.logged_at
         FROM activity_logs al
         JOIN activities a ON al.activity_id = a.id
         ${guildFilterAliased}
         ORDER BY al.logged_date DESC`,
      )
      .all(...guildParams) as SqliteLog[];

    const logItems = logs.map((l) => {
      const actName = l.activity_name.toLowerCase();
      return {
        PK: `GUILD#${l.guild_id}`,
        SK: `LOG#${l.logged_date}#${l.user_id}#${actName}`,
        GSI1PK: `USER#${l.user_id}`,
        GSI1SK: `LOG#${l.guild_id}#${l.logged_date}`,
        guildId: l.guild_id,
        userId: l.user_id,
        activityName: actName,
        date: l.logged_date,
        loggedAt: l.logged_at || now,
        entityType: 'LOG',
      };
    });

    totalLogs = await batchWrite(docClient, tableName, logItems, dryRun, 'log');

    // ── 3. Tracked channels ──────────────────────────────────────────────────

    console.log('3. Migrating tracked channels...');
    const channels = db
      .prepare(`SELECT * FROM tracked_channels ${guildFilter}`)
      .all(...guildParams) as SqliteChannel[];

    const channelItems = channels.map((c) => ({
      PK: `GUILD#${c.guild_id}`,
      SK: `CHANNEL#${c.channel_id}`,
      ...(c.last_panel_message_id && { lastPanelMessageId: c.last_panel_message_id }),
      createdAt: now,
      entityType: 'CHANNEL',
    }));

    totalChannels = await batchWrite(docClient, tableName, channelItems, dryRun, 'channel');

    // ── 4. Streaks (computed from logs) ──────────────────────────────────────

    console.log('4. Computing and migrating streaks...');

    // Group logs by guild+user
    const userLogs = new Map<string, SqliteLog[]>();
    for (const log of logs) {
      const key = `${log.guild_id}|${log.user_id}`;
      if (!userLogs.has(key)) userLogs.set(key, []);
      userLogs.get(key)!.push(log);
    }

    const streakItems: Record<string, unknown>[] = [];
    for (const [key, userLogEntries] of userLogs) {
      const [guildId, userId] = key.split('|');
      const streak = computeStreak(userLogEntries);

      if (!streak.lastLoggedDate) continue;

      const padded = padStreak(streak.currentStreak);
      streakItems.push({
        PK: `GUILD#${guildId}`,
        SK: `STREAK#${userId}`,
        GSI1PK: `LEADERBOARD#${guildId}`,
        GSI1SK: `STREAK#${padded}`,
        guildId,
        userId,
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
        currentStreakPadded: padded,
        lastLoggedDate: streak.lastLoggedDate,
        updatedAt: now,
        entityType: 'STREAK',
        consecutiveRestOnlyDays: streak.consecutiveRestOnlyDays,
        lastDayHasNonRest: streak.lastDayHasNonRest,
      });
    }

    totalStreaks = await batchWrite(docClient, tableName, streakItems, dryRun, 'streak');

    // ── Summary ──────────────────────────────────────────────────────────────

    console.log('');
    console.log('=== Migration Summary ===');
    console.log(`  Activities: ${totalActivities}`);
    console.log(`  Logs:       ${totalLogs}`);
    console.log(`  Channels:   ${totalChannels}`);
    console.log(`  Streaks:    ${totalStreaks}`);
    console.log(`  Total:      ${totalActivities + totalLogs + totalChannels + totalStreaks}`);
    if (dryRun) console.log('  (DRY RUN — nothing was written)');
  } finally {
    db.close();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
