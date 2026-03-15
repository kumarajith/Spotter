import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { DiscordController } from './discord.controller';
import { ActivityModule } from '../activity/activity.module';
import { PanelModule } from '../panel/panel.module';
import { SqsModule } from '../sqs/sqs.module';

@Module({
  imports: [ActivityModule, PanelModule, SqsModule],
  controllers: [DiscordController],
  providers: [DiscordService],
})
export class DiscordModule {}
