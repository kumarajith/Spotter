import { ActivityRepository } from '../activity/activity.repository';
import { DEFAULT_ACTIVITIES } from '../activity/activity.defaults';
import { Db } from '../db/db';
import { createTestDb, uniqueGuildId } from '../db/test-db';
import { PanelRepository } from '../panel/panel.repository';
import { TrackingRepository } from '../tracking/tracking.repository';
import {
  createRepositories,
  MirroredActivityRepository,
  MirroredPanelRepository,
  MirroredTrackingRepository,
} from './mirror';

function conditionalCheckFailed(): Error {
  return Object.assign(new Error('The conditional request failed'), {
    name: 'ConditionalCheckFailedException',
  });
}

describe('DynamoDB mirror', () => {
  let db: Db;
  let guildId: string;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(() => {
    guildId = uniqueGuildId();
  });

  describe('logs', () => {
    const dynamo = { logActivity: jest.fn() };
    let tracking: MirroredTrackingRepository;

    beforeEach(() => {
      dynamo.logActivity.mockReset().mockResolvedValue({ alreadyLogged: false });
      tracking = new MirroredTrackingRepository(db, dynamo as any);
    });

    it('writes a log to SQL and to DynamoDB', async () => {
      const result = await tracking.logActivity(guildId, 'u1', 'push', '2025-06-15');

      expect(result).toEqual({ alreadyLogged: false });
      expect(await tracking.getUserActivityCounts(guildId, 'u1')).toEqual(new Map([['push', 1]]));
      expect(dynamo.logActivity).toHaveBeenCalledWith(guildId, 'u1', 'push', '2025-06-15');
    });

    it('fails the request when the DynamoDB write fails', async () => {
      dynamo.logActivity.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

      await expect(tracking.logActivity(guildId, 'u1', 'push', '2025-06-15')).rejects.toThrow(
        'DynamoDB unavailable',
      );
    });

    it('a retry after such a failure completes the DynamoDB write', async () => {
      dynamo.logActivity.mockRejectedValueOnce(new Error('DynamoDB unavailable'));
      await tracking.logActivity(guildId, 'u1', 'push', '2025-06-15').catch(() => undefined);

      const retry = await tracking.logActivity(guildId, 'u1', 'push', '2025-06-15');

      expect(retry).toEqual({ alreadyLogged: true }); // SQL already had it
      expect(dynamo.logActivity).toHaveBeenCalledTimes(2); // and DynamoDB now has it too
    });
  });

  describe('activities', () => {
    const dynamo = { putActivity: jest.fn(), deleteActivity: jest.fn() };
    let activities: MirroredActivityRepository;

    beforeEach(() => {
      dynamo.putActivity.mockReset().mockResolvedValue(undefined);
      dynamo.deleteActivity.mockReset().mockResolvedValue(undefined);
      activities = new MirroredActivityRepository(db, dynamo as any);
    });

    it('adds to both stores', async () => {
      expect(await activities.putActivity(guildId, 'Yoga', '🧘', false, 'u1')).toBe(true);

      expect(dynamo.putActivity).toHaveBeenCalledWith(guildId, 'Yoga', '🧘', false, 'u1');
    });

    it('reports a duplicate from SQL and tolerates DynamoDB already having it', async () => {
      await activities.putActivity(guildId, 'Yoga', '🧘', false, 'u1');
      dynamo.putActivity.mockRejectedValueOnce(conditionalCheckFailed());

      expect(await activities.putActivity(guildId, 'yoga', '', false, 'u2')).toBe(false);
    });

    it('does not swallow other DynamoDB errors', async () => {
      dynamo.putActivity.mockRejectedValueOnce(new Error('throttled'));

      await expect(activities.putActivity(guildId, 'Yoga', '🧘', false, 'u1')).rejects.toThrow(
        'throttled',
      );
    });

    it('removes from both stores', async () => {
      await activities.putActivity(guildId, 'Yoga', '🧘', false, 'u1');

      await activities.deleteActivity(guildId, 'Yoga');

      expect(await activities.getActivities(guildId)).toEqual([]);
      expect(dynamo.deleteActivity).toHaveBeenCalledWith(guildId, 'Yoga');
    });

    it('seeds every default into both stores', async () => {
      await activities.seedDefaults(guildId);

      expect(await activities.getActivities(guildId)).toHaveLength(DEFAULT_ACTIVITIES.length);
      expect(dynamo.putActivity).toHaveBeenCalledTimes(DEFAULT_ACTIVITIES.length);
    });
  });

  describe('channels', () => {
    it('records the panel message in both stores', async () => {
      const dynamo = { upsertChannel: jest.fn().mockResolvedValue(undefined) };
      const panels = new MirroredPanelRepository(db, dynamo as any);

      await panels.upsertChannel(guildId, 'c1', 'm1');

      expect(await panels.getChannel(guildId, 'c1')).toEqual({
        guildId,
        channelId: 'c1',
        lastPanelMessageId: 'm1',
      });
      expect(dynamo.upsertChannel).toHaveBeenCalledWith(guildId, 'c1', 'm1');
    });
  });

  describe('createRepositories', () => {
    const original = process.env.TABLE_NAME;

    afterEach(() => {
      if (original === undefined) delete process.env.TABLE_NAME;
      else process.env.TABLE_NAME = original;
    });

    it('mirrors when TABLE_NAME is set', () => {
      process.env.TABLE_NAME = 'spotter-test';

      const repositories = createRepositories(db);

      expect(repositories.tracking).toBeInstanceOf(MirroredTrackingRepository);
      expect(repositories.activities).toBeInstanceOf(MirroredActivityRepository);
      expect(repositories.panels).toBeInstanceOf(MirroredPanelRepository);
    });

    it('is plain SQL without it', () => {
      delete process.env.TABLE_NAME;

      const repositories = createRepositories(db);

      expect(repositories.tracking.constructor).toBe(TrackingRepository);
      expect(repositories.activities.constructor).toBe(ActivityRepository);
      expect(repositories.panels.constructor).toBe(PanelRepository);
    });
  });
});
