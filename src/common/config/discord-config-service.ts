export interface DiscordCredentials {
  botToken: string;
  publicKey: string;
  applicationId: string;
}

/**
 * Plain config class that reads Discord credentials from environment variables.
 * Replaces the NestJS DiscordConfigService that fetched from SSM on module init.
 * Construction is synchronous — no async init, no network calls, no cold-start penalty.
 */
export class DiscordConfigService {
  readonly botToken: string;
  readonly publicKey: string;
  readonly applicationId: string;

  constructor() {
    this.botToken = process.env.DISCORD_BOT_TOKEN ?? '';
    this.publicKey = process.env.DISCORD_PUBLIC_KEY ?? '';
    this.applicationId = process.env.DISCORD_APPLICATION_ID ?? '';

    if (!this.publicKey || !this.botToken) {
      throw new Error(
        'Missing required Discord credentials (DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN)',
      );
    }
  }
}
