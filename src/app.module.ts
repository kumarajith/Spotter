import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscordModule } from './discord/discord.module';
import { DiscordConfigModule } from './common/config/discord-config.module';
import { DynamoModule } from './common/dynamodb/dynamodb.module';
import { ActivityModule } from './activity/activity.module';
import { SqsModule } from './sqs/sqs.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ActivityModule,
    DynamoModule,
    DiscordModule,
    DiscordConfigModule,
    SqsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
