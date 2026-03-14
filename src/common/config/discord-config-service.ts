import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

interface DiscordCredentials {
  botToken: string;
  publicKey: string;
  applicationId: string;
}

@Injectable()
export class DiscordConfigService implements OnModuleInit {
  private readonly logger = new Logger(DiscordConfigService.name);
  private credentials!: DiscordCredentials;

  get botToken(): string {
    return this.credentials.botToken;
  }

  get publicKey(): string {
    return this.credentials.publicKey;
  }

  get applicationId(): string {
    return this.credentials.applicationId;
  }

  async onModuleInit(): Promise<void> {
    const paramName = process.env.DISCORD_PARAM_NAME;

    if (paramName) {
      const raw = await this.fetchFromSsm(paramName);
      this.credentials = JSON.parse(raw) as DiscordCredentials;
      this.logger.log('Discord credentials loaded from SSM');
    } else {
      this.credentials = {
        botToken: process.env.DISCORD_BOT_TOKEN ?? '',
        publicKey: process.env.DISCORD_PUBLIC_KEY ?? '',
        applicationId: process.env.DISCORD_APPLICATION_ID ?? '',
      };
      this.logger.log('Discord credentials loaded from environment variables');
    }

    if (!this.credentials.publicKey || !this.credentials.botToken) {
      throw new Error('Missing required Discord credentials (publicKey, botToken)');
    }
  }

  private async fetchFromSsm(paramName: string): Promise<string> {
    const client = new SSMClient({});
    const command = new GetParameterCommand({
      Name: paramName,
      WithDecryption: true,
    });

    const response = await client.send(command);
    const value = response.Parameter?.Value;

    if (!value) {
      throw new Error(`SSM parameter ${paramName} is empty or not found`);
    }

    return value;
  }
}
