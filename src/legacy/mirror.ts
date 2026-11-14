import { ActivityRepository } from '../activity/activity.repository';
import { Db } from '../db/db';
import { PanelRepository } from '../panel/panel.repository';
import { TrackingRepository } from '../tracking/tracking.repository';
import { ActivityRepository as DynamoActivityRepository } from './activity.repository';
import { DynamoService } from './dynamodb.service';
import { PanelRepository as DynamoPanelRepository } from './panel.repository';
import { TrackingRepository as DynamoTrackingRepository } from './tracking.repository';

/**
 * Temporary, for the v4 cutover: every write goes to the SQL database first and
 * is then repeated against the old DynamoDB table in its original item format,
 * so DynamoDB stays a complete copy until it is retired.
 *
 * The DynamoDB write is required, not best-effort — if it fails the request
 * fails and the user retries. Both sides are idempotent, so a retry converges.
 * Reads are never mirrored; they come from SQL only.
 */

export class MirroredTrackingRepository extends TrackingRepository {
  constructor(
    db: Db,
    private readonly dynamo: DynamoTrackingRepository,
  ) {
    super(db);
  }

  async logActivity(guildId: string, userId: string, activityName: string, date: string) {
    const result = await super.logActivity(guildId, userId, activityName, date);
    // Runs even when SQL reports "already logged": that is what lets a retry
    // complete a mirror write that failed the first time.
    await this.dynamo.logActivity(guildId, userId, activityName, date);
    return result;
  }
}

export class MirroredActivityRepository extends ActivityRepository {
  constructor(
    db: Db,
    private readonly dynamo: DynamoActivityRepository,
  ) {
    super(db);
  }

  async putActivity(
    guildId: string,
    displayName: string,
    emoji: string,
    isDefault: boolean,
    createdBy: string,
  ): Promise<boolean> {
    const created = await super.putActivity(guildId, displayName, emoji, isDefault, createdBy);
    try {
      await this.dynamo.putActivity(guildId, displayName, emoji, isDefault, createdBy);
    } catch (err) {
      // The DynamoDB put is conditional; "already there" is the expected outcome
      // whenever SQL also said the activity exists.
      if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
    }
    return created;
  }

  async deleteActivity(guildId: string, displayName: string): Promise<void> {
    await super.deleteActivity(guildId, displayName);
    await this.dynamo.deleteActivity(guildId, displayName);
  }

  async seedDefaults(guildId: string): Promise<void> {
    await super.seedDefaults(guildId);
    // The DynamoDB side adds whichever defaults are missing, in parallel.
    await this.dynamo.seedDefaults(guildId);
  }
}

export class MirroredPanelRepository extends PanelRepository {
  constructor(
    db: Db,
    private readonly dynamo: DynamoPanelRepository,
  ) {
    super(db);
  }

  async upsertChannel(guildId: string, channelId: string, messageId: string): Promise<void> {
    await super.upsertChannel(guildId, channelId, messageId);
    await this.dynamo.upsertChannel(guildId, channelId, messageId);
  }
}

export interface Repositories {
  tracking: TrackingRepository;
  activities: ActivityRepository;
  panels: PanelRepository;
}

/**
 * The repositories the app should use. With TABLE_NAME set (deployed
 * environments during the cutover) writes are mirrored to DynamoDB; without it
 * (local dev, and everywhere once DynamoDB is retired) they are plain SQL.
 */
export function createRepositories(db: Db): Repositories {
  if (!process.env.TABLE_NAME) {
    return {
      tracking: new TrackingRepository(db),
      activities: new ActivityRepository(db),
      panels: new PanelRepository(db),
    };
  }

  const dynamo = new DynamoService();
  return {
    tracking: new MirroredTrackingRepository(db, new DynamoTrackingRepository(dynamo)),
    activities: new MirroredActivityRepository(db, new DynamoActivityRepository(dynamo)),
    panels: new MirroredPanelRepository(db, new DynamoPanelRepository(dynamo)),
  };
}
