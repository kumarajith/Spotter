import { Global, Module } from '@nestjs/common';
import { DiscordConfigService } from './discord-config-service';

@Global()
@Module({
  providers: [DiscordConfigService],
  exports: [DiscordConfigService],
})
export class DiscordConfigModule {}
