import { Module } from '@nestjs/common';
import { DynamoModule } from '../common/dynamodb/dynamodb.module';
import { DiscordConfigModule } from '../common/config/discord-config.module';
import { PanelModule } from '../panel/panel.module';
import { TrackingModule } from '../tracking/tracking.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [DynamoModule, DiscordConfigModule, PanelModule, TrackingModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
