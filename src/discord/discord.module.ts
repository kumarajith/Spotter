import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { DiscordController } from './discord.controller';
import { ActivityModule } from '../activity/activity.module';
import { PanelModule } from '../panel/panel.module';

@Module({
  imports: [ActivityModule, PanelModule],
  controllers: [DiscordController],
  providers: [DiscordService],
})
export class DiscordModule {}
