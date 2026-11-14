import { addDays } from '../common/dates';
import { Db } from '../db/db';
import { runMigrations } from '../db/migrate';
import { PgliteDb } from '../db/pglite';
import { StreakRepository } from '../tracking/streak.repository';
import { DynamoService } from './dynamodb.service';
import { importLegacyData, scanLegacyTable } from './import-dynamo';
import { verifyAgainstLegacy } from './verify';

const TODAY = '2025-06-15';
const G = 'guild-1';

// -- DynamoDB items exactly as the pre-v4 code wrote them --------------------

const log = (userId: string, date: string, activityName: string, guildId = G) => ({
  PK: `GUILD#${guildId}`,
  SK: `LOG#${date}#${userId}#${activityName}`,
  GSI1PK: `USER#${userId}`,
  GSI1SK: `LOG#${guildId}#${date}`,
  guildId,
  userId,
  activityName,
  date,
  loggedAt: `${date}T18:30:00.000Z`,
  entityType: 'LOG',
});

const activity = (displayName: string, emoji: string, isDefault = true) => ({
  PK: `GUILD#${G}`,
  SK: `ACTIVITY#${displayName.toLowerCase()}`,
  displayName,
  emoji,
  isDefault,
  createdBy: 'system',
  createdAt: '2025-01-01T00:00:00.000Z',
  entityType: 'ACTIVITY',
});

const channel = (channelId: string, lastPanelMessageId?: string) => ({
  PK: `GUILD#${G}`,
  SK: `CHANNEL#${channelId}`,
  ...(lastPanelMessageId && { lastPanelMessageId }),
  createdAt: '2025-01-01T00:00:00.000Z',
  entityType: 'CHANNEL',
});

const streak = (
  userId: string,
  currentStreak: number,
  longestStreak: number,
  lastLoggedDate: string,
) => ({
  PK: `GUILD#${G}`,
  SK: `STREAK#${userId}`,
  GSI1PK: `LEADERBOARD#${G}`,
  GSI1SK: `STREAK#${String(currentStreak).padStart(5, '0')}`,
  guildId: G,
  userId,
  currentStreak,
  longestStreak,
  lastLoggedDate,
  entityType: 'STREAK',
});

/** A DynamoService whose scan serves the given items, two per page. */
function fakeTable(items: Record<string, unknown>[]): DynamoService {
  return {
    scan: jest.fn(({ ExclusiveStartKey }: { ExclusiveStartKey?: { offset: number } }) => {
      const offset = ExclusiveStartKey?.offset ?? 0;
      const next = offset + 2;
      return Promise.resolve({
        Items: items.slice(offset, next),
        LastEvaluatedKey: next < items.length ? { offset: next } : undefined,
      });
    }),
  } as unknown as DynamoService;
}

// These compare whole tables, so they need a database of their own each time.
const describeLocal = process.env.TEST_DSQL_ENDPOINT ? describe.skip : describe;

describeLocal('DynamoDB -> SQL import and verify', () => {
  let db: Db;

  beforeEach(async () => {
    db = new PgliteDb();
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.end();
  });

  const lastThreeDays = [
    log('u1', addDays(TODAY, -2), 'push'),
    log('u1', addDays(TODAY, -1), 'pull'),
    log('u1', TODAY, 'legs'),
    log('u1', TODAY, 'walk'),
  ];

  describe('scanLegacyTable', () => {
    it('reads every page with consistent reads and sorts items by entity', async () => {
      const table = fakeTable([
        ...lastThreeDays,
        activity('Push', '🫸'),
        channel('c1', 'm1'),
        streak('u1', 3, 9, TODAY),
      ]);

      const data = await scanLegacyTable(table);

      expect(table.scan).toHaveBeenCalledTimes(4);
      expect(table.scan).toHaveBeenCalledWith(expect.objectContaining({ ConsistentRead: true }));
      expect(data.logs).toHaveLength(4);
      expect(data.logs[0]).toEqual({
        guildId: G,
        userId: 'u1',
        date: addDays(TODAY, -2),
        activityName: 'push',
        loggedAt: `${addDays(TODAY, -2)}T18:30:00.000Z`,
      });
      expect(data.activities).toEqual([expect.objectContaining({ name: 'push', emoji: '🫸' })]);
      expect(data.channels).toEqual([
        expect.objectContaining({ channelId: 'c1', lastPanelMessageId: 'm1' }),
      ]);
      expect(data.streaks).toEqual([
        { guildId: G, userId: 'u1', currentStreak: 3, longestStreak: 9, lastLoggedDate: TODAY },
      ]);
      expect(data.unrecognised).toEqual([]);
    });

    it('reports items it does not understand instead of dropping them silently', async () => {
      const data = await scanLegacyTable(fakeTable([{ PK: 'GUILD#g', SK: 'MYSTERY#1' }]));

      expect(data.unrecognised).toEqual(['GUILD#g | MYSTERY#1']);
    });
  });

  describe('importLegacyData', () => {
    it('copies logs, activities and channels, and is a no-op the second time', async () => {
      const data = await scanLegacyTable(
        fakeTable([...lastThreeDays, activity('Push', '🫸'), channel('c1', 'm1')]),
      );

      const first = await importLegacyData(db, data);
      const second = await importLegacyData(db, data);

      expect(first.inserted).toEqual({ logs: 4, activities: 1, channels: 1, bestStreakFloors: 0 });
      expect(second.inserted).toEqual({ logs: 0, activities: 0, channels: 0, bestStreakFloors: 0 });
      expect(await new StreakRepository(db).getUserStreak(G, 'u1', TODAY)).toEqual({
        userId: 'u1',
        currentStreak: 3,
        bestStreak: 3,
      });
      const [stored] = await db.query(
        `SELECT CAST(logged_at AT TIME ZONE 'UTC' AS text) AS logged_at
         FROM activity_logs WHERE activity_name = 'legs'`,
      );
      expect(stored.logged_at).toBe(`${TODAY} 18:30:00`);
    });

    it('copies more rows than fit in one batch', async () => {
      const many = Array.from({ length: 1203 }, (_, i) => log(`u${i}`, TODAY, 'push'));

      const summary = await importLegacyData(db, await scanLegacyTable(fakeTable(many)));

      expect(summary.inserted.logs).toBe(1203);
      const [{ n }] = await db.query('SELECT CAST(COUNT(*) AS integer) AS n FROM activity_logs');
      expect(n).toBe(1203);
    });

    it('keeps a stored best streak that the logs cannot reproduce, and only then', async () => {
      const data = await scanLegacyTable(
        fakeTable([
          ...lastThreeDays,
          streak('u1', 3, 40, TODAY), // logs only show 3
          log('u2', TODAY, 'push'),
          streak('u2', 1, 1, TODAY), // logs agree
        ]),
      );

      const summary = await importLegacyData(db, data);

      expect(summary.inserted.bestStreakFloors).toBe(1);
      const streaks = new StreakRepository(db);
      expect(await streaks.getUserStreak(G, 'u1', TODAY)).toMatchObject({ bestStreak: 40 });
      expect(await streaks.getUserStreak(G, 'u2', TODAY)).toMatchObject({ bestStreak: 1 });
    });

    it('reports a log whose date is not a real day rather than failing the copy', async () => {
      const data = await scanLegacyTable(
        fakeTable([log('u1', '2025-02-31', 'push'), log('u1', TODAY, 'push')]),
      );

      const summary = await importLegacyData(db, data);

      expect(summary.inserted.logs).toBe(1);
      expect(summary.invalidDateLogs).toEqual([`${G} | u1 | 2025-02-31 | push`]);
    });
  });

  describe('verifyAgainstLegacy', () => {
    it('copies what is missing, then reports both stores as identical', async () => {
      const table = fakeTable([
        ...lastThreeDays,
        activity('Push', '🫸'),
        channel('c1', 'm1'),
        streak('u1', 3, 3, TODAY),
      ]);

      const report = await verifyAgainstLegacy(db, table, TODAY);

      expect(report.ok).toBe(true);
      expect(report.copy.inserted.logs).toBe(4);
      expect(report.rows.logs).toMatchObject({ dynamo: 4, sql: 4 });
      expect(report.rows.activities).toMatchObject({ dynamo: 1, sql: 1 });
      expect(report.rows.channels).toMatchObject({ dynamo: 1, sql: 1 });
      expect(report.streaks).toEqual({ compared: 1, differences: [] });
    });

    it('flags rows that exist only in SQL (a mirror write that never happened)', async () => {
      await db.query(
        `INSERT INTO activity_logs (guild_id, user_id, log_date, activity_name)
         VALUES ($1, 'u9', $2::date, 'push')`,
        [G, TODAY],
      );

      const report = await verifyAgainstLegacy(db, fakeTable(lastThreeDays), TODAY);

      expect(report.ok).toBe(false);
      expect(report.rows.logs.onlyInSql).toEqual([`${G} | u9 | ${TODAY} | push`]);
      expect(report.rows.logs.onlyInDynamoCount).toBe(0);
    });

    it('flags a DynamoDB row that could not be copied', async () => {
      const report = await verifyAgainstLegacy(
        db,
        fakeTable([log('u1', '2025-02-31', 'push')]),
        TODAY,
      );

      expect(report.ok).toBe(false);
      expect(report.rows.logs.onlyInDynamo).toEqual([`${G} | u1 | 2025-02-31 | push`]);
    });

    it('ignores activities that were removed after the switch', async () => {
      await db.query(
        `INSERT INTO activities (guild_id, name, display_name, created_by, removed_at)
         VALUES ($1, 'yoga', 'Yoga', 'u1', now())`,
        [G],
      );

      const report = await verifyAgainstLegacy(db, fakeTable([activity('Push', '🫸')]), TODAY);

      expect(report.rows.activities).toMatchObject({ dynamo: 1, sql: 1, onlyInSqlCount: 0 });
    });

    it('flags a channel whose panel message differs between the stores', async () => {
      await db.query(
        `INSERT INTO tracked_channels (guild_id, channel_id, last_panel_message_id)
         VALUES ($1, 'c1', 'newer')`,
        [G],
      );

      const report = await verifyAgainstLegacy(db, fakeTable([channel('c1', 'older')]), TODAY);

      expect(report.ok).toBe(false);
      expect(report.rows.channels.onlyInDynamo).toEqual([`${G} | c1 | older`]);
      expect(report.rows.channels.onlyInSql).toEqual([`${G} | c1 | newer`]);
    });

    it('lists users whose derived streak differs from the stored one', async () => {
      const table = fakeTable([
        ...lastThreeDays,
        streak('u1', 7, 7, TODAY), // stored says 7, logs say 3 (best is floored to 7)
        log('u2', addDays(TODAY, -5), 'push'),
        streak('u2', 4, 4, addDays(TODAY, -5)), // stale: counts as 0, and so does the view
      ]);

      const report = await verifyAgainstLegacy(db, table, TODAY);

      expect(report.ok).toBe(true); // rows match; streak differences are for a human to read
      expect(report.streaks.compared).toBe(2);
      expect(report.streaks.differences).toEqual([
        {
          guildId: G,
          userId: 'u1',
          stored: { current: 7, best: 7 },
          derived: { current: 3, best: 7 },
        },
      ]);
    });
  });
});
