import { Injectable } from '@nestjs/common';
import { DynamoService } from '../common/dynamodb/dynamodb.service';
import { TrackedChannelItem } from '../common/types/dynamo.types';

@Injectable()
export class PanelRepository {
  constructor(private readonly dynamo: DynamoService) {}

  async getChannel(guildId: string, channelId: string): Promise<TrackedChannelItem | null> {
    const result = await this.dynamo.get({
      PK: `GUILD#${guildId}`,
      SK: `CHANNEL#${channelId}`,
    });
    return (result.Item as TrackedChannelItem) ?? null;
  }

  async upsertChannel(guildId: string, channelId: string, messageId: string): Promise<void> {
    const item: TrackedChannelItem = {
      PK: `GUILD#${guildId}`,
      SK: `CHANNEL#${channelId}`,
      lastPanelMessageId: messageId,
      createdAt: new Date().toISOString(),
      entityType: 'CHANNEL',
    };
    await this.dynamo.put(item as unknown as Record<string, unknown>);
  }
}
