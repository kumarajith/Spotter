import { Db } from '../db/db';
import { createTestDb, uniqueGuildId } from '../db/test-db';
import { TrackingRepository } from './tracking.repository';

describe('TrackingRepository', () => {
  let db: Db;
  let tracking: TrackingRepository;
  let guildId: string;

  beforeAll(async () => {
    db = await createTestDb();
    tracking = new TrackingRepository(db);
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(() => {
    guildId = uniqueGuildId();
  });

  it('logs an activity once per user per day', async () => {
    expect(await tracking.logActivity(guildId, 'u1', 'push', '2025-06-15')).toEqual({
      alreadyLogged: false,
    });
    expect(await tracking.logActivity(guildId, 'u1', 'push', '2025-06-15')).toEqual({
      alreadyLogged: true,
    });

    // Another activity, another day and another user are all separate logs.
    for (const [user, activity, date] of [
      ['u1', 'legs', '2025-06-15'],
      ['u1', 'push', '2025-06-16'],
      ['u2', 'push', '2025-06-15'],
    ]) {
      expect(await tracking.logActivity(guildId, user, activity, date)).toEqual({
        alreadyLogged: false,
      });
    }
  });

  it('returns logs in a date range, both ends included, newest first', async () => {
    for (const date of ['2025-06-10', '2025-06-11', '2025-06-12', '2025-06-13']) {
      await tracking.logActivity(guildId, 'u1', 'push', date);
    }
    await tracking.logActivity(guildId, 'u1', 'rest', '2025-06-12');
    await tracking.logActivity(guildId, 'u2', 'push', '2025-06-12');

    expect(await tracking.getUserLogsForRange(guildId, 'u1', '2025-06-11', '2025-06-12')).toEqual([
      { date: '2025-06-12', activityName: 'push' },
      { date: '2025-06-12', activityName: 'rest' },
      { date: '2025-06-11', activityName: 'push' },
    ]);
  });

  it('counts logs per activity', async () => {
    await tracking.logActivity(guildId, 'u1', 'push', '2025-06-10');
    await tracking.logActivity(guildId, 'u1', 'push', '2025-06-11');
    await tracking.logActivity(guildId, 'u1', 'rest', '2025-06-12');

    expect(await tracking.getUserActivityCounts(guildId, 'u1')).toEqual(
      new Map([
        ['push', 2],
        ['rest', 1],
      ]),
    );
    expect(await tracking.getUserActivityCounts(guildId, 'nobody')).toEqual(new Map());
  });
});
