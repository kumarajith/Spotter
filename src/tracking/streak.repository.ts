import { Injectable } from '@nestjs/common';
import { DynamoService } from '../common/dynamodb/dynamodb.service';
import { StreakItem } from '../common/types/dynamo.types';

@Injectable()
export class StreakRepository {
  constructor(private readonly dynamo: DynamoService) {}

  async getStreak(guildId: string, userId: string): Promise<StreakItem | null> {
    const result = await this.dynamo.get({
      PK: `GUILD#${guildId}`,
      SK: `STREAK#${userId}`,
    });
    return (result.Item as StreakItem | undefined) ?? null;
  }

  async putStreak(item: StreakItem): Promise<void> {
    await this.dynamo.put(item as unknown as Record<string, unknown>);
  }

  /**
   * Returns top N users by current streak for the guild leaderboard.
   * Queries GSI1 DESC, excluding users with a 0 streak.
   */
  async getTopCurrentStreaks(guildId: string, limit = 10): Promise<StreakItem[]> {
    const result = await this.dynamo.query({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK > :zero',
      ExpressionAttributeValues: {
        ':pk': `LEADERBOARD#${guildId}`,
        ':zero': 'STREAK#00000',
      },
      ScanIndexForward: false,
      Limit: limit,
    });

    return (result.Items ?? []) as StreakItem[];
  }

  /**
   * Returns all streak items for a guild.
   * Used to compute all-time best by sorting on longestStreak in app code.
   * Hard cap of 500 items — sufficient for fitness guild scale.
   */
  async getAllGuildStreaks(guildId: string): Promise<StreakItem[]> {
    const result = await this.dynamo.query({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `GUILD#${guildId}`,
        ':skPrefix': 'STREAK#',
      },
      Limit: 500,
    });

    return (result.Items ?? []) as StreakItem[];
  }

  /**
   * Returns all activity logs for a user in a guild, sorted DESC by date.
   * Used by recomputeStreak() for backfill.
   */
  async getUserLogs(
    guildId: string,
    userId: string,
  ): Promise<Array<{ date: string; activityName: string }>> {
    const result = await this.dynamo.query({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': `LOG#${guildId}#`,
      },
      ScanIndexForward: false, // DESC — newest first, matching legacy sort order
    });

    return (result.Items ?? []).map((item) => ({
      date: item['date'] as string,
      activityName: item['activityName'] as string,
    }));
  }
}
