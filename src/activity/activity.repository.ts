import { Injectable } from '@nestjs/common';
import { DynamoService } from '../common/dynamodb/dynamodb.service';
import { ActivityItem } from '../common/types/dynamo.types';
import { DEFAULT_ACTIVITIES } from './activity.defaults';

@Injectable()
export class ActivityRepository {
  constructor(private readonly dynamo: DynamoService) {}
  async getActivities(guildId: string): Promise<ActivityItem[]> {
    const result = await this.dynamo.query({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `GUILD#${guildId}`, ':prefix': 'ACTIVITY#' },
    });

    return (result.Items ?? []) as ActivityItem[];
  }

  async putActivity(
    guildId: string,
    displayName: string,
    emoji: string,
    isDefault: boolean,
    createdBy: string,
  ): Promise<void> {
    await this.dynamo.put(
      {
        PK: `GUILD#${guildId}`,
        SK: `ACTIVITY#${displayName.toLowerCase()}`,
        displayName,
        emoji,
        isDefault,
        createdBy,
        createdAt: new Date().toISOString(),
        entityType: 'ACTIVITY',
      },
      { ConditionExpression: 'attribute_not_exists(SK)' },
    );
  }

  async deleteActivity(guildId: string, displayName: string): Promise<void> {
    await this.dynamo.delete({
      PK: `GUILD#${guildId}`,
      SK: `ACTIVITY#${displayName.toLowerCase()}`,
    });
  }

  async seedDefaults(guildId: string): Promise<void> {
    await Promise.all(
      DEFAULT_ACTIVITIES.map((activity) =>
        this.putActivity(guildId, activity.displayName, activity.emoji, true, 'system').catch(
          (err: Error & { name: string }) => {
            if (err.name === 'ConditionalCheckFailedException') return;
            throw err;
          },
        ),
      ),
    );
  }
}
