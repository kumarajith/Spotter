import { Injectable } from '@nestjs/common';
import { DynamoService } from '../common/dynamodb/dynamodb.service';
import { ActivityLogItem } from '../common/types/dynamo.types';

const LOG_TTL_DAYS = 90;

@Injectable()
export class TrackingRepository {
  constructor(private readonly dynamo: DynamoService) {}

  async logActivity(
    guildId: string,
    userId: string,
    activityName: string,
    date: string,
  ): Promise<{ alreadyLogged: boolean }> {
    const ttl =
      Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000) + LOG_TTL_DAYS * 24 * 60 * 60;

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
      ttl,
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
