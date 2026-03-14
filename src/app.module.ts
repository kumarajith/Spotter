import { Module } from '@nestjs/common';
import { DiscordModule } from './discord/discord.module';
import { DiscordConfigModule } from './common/config/discord-config.module';

@Module({
  imports: [DiscordModule, DiscordConfigModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
