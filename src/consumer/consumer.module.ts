import { Module } from '@nestjs/common';
import { DiscordConfigModule } from '../common/config/discord-config.module';
import { DynamoModule } from '../common/dynamodb/dynamodb.module';
import { TrackingModule } from '../tracking/tracking.module';
import { ConsumerService } from './consumer.service';

@Module({
  imports: [DynamoModule, DiscordConfigModule, TrackingModule],
  providers: [ConsumerService],
})
export class ConsumerModule {}
