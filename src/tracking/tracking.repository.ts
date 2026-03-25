import { DynamoService } from '../common/dynamodb/dynamodb.service';
import { ActivityLogItem } from '../common/types/dynamo.types';

export class TrackingRepository {
  constructor(private readonly dynamo: DynamoService) {}

  async getUserLogsForRange(
    guildId: string,
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<Array<{ date: string; activityName: string }>> {
    const result = await this.dynamo.query({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':start': `LOG#${guildId}#${startDate}`,
        ':end': `LOG#${guildId}#${endDate}`,
      },
      ScanIndexForward: false,
    });

    return (result.Items ?? []).map((item) => ({
      date: item['date'] as string,
      activityName: item['activityName'] as string,
    }));
  }

  async getUserActivityCounts(guildId: string, userId: string): Promise<Map<string, number>> {
    const result = await this.dynamo.query({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': `LOG#${guildId}#`,
      },
    });

    const counts = new Map<string, number>();
    for (const item of result.Items ?? []) {
      const name = item['activityName'] as string;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  }

  async logActivity(
    guildId: string,
    userId: string,
    activityName: string,
    date: string,
  ): Promise<{ alreadyLogged: boolean }> {
    const item: ActivityLogItem = {
      PK: `GUILD#${guildId}`,
      SK: `LOG#${date}#${userId}#${activityName}`,
      GSI1PK: `USER#${userId}`,
      GSI1SK: `LOG#${guildId}#${date}`,
      guildId,
      userId,
      activityName,
      date,
      loggedAt: new Date().toISOString(),
      entityType: 'LOG',
    };

    try {
      await this.dynamo.put(item as unknown as Record<string, unknown>, {
        ConditionExpression: 'attribute_not_exists(SK)',
      });
      return { alreadyLogged: false };
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        return { alreadyLogged: true };
      }
      throw err;
    }
  }
}
