import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscordModule } from './discord/discord.module';
import { DiscordConfigModule } from './common/config/discord-config.module';

@Module({
  imports: [ConfigModule.forRoot(), DiscordModule, DiscordConfigModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
