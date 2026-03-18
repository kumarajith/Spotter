import { Injectable, Logger } from '@nestjs/common';
import { DiscordConfigService } from '../common/config/discord-config-service';
import { TrackingRepository } from '../tracking/tracking.repository';
import { StreakService } from '../tracking/streak.service';
import {
  ActivityLoggedMessage,
  BackfillActivityMessage,
  SqsMessage,
} from '../common/types/sqs.types';

@Injectable()
export class ConsumerService {
  private readonly logger = new Logger(ConsumerService.name);

  constructor(
    private readonly discordConfig: DiscordConfigService,
    private readonly trackingRepository: TrackingRepository,
    private readonly streakService: StreakService,
  ) {}

  async processMessage(msg: SqsMessage): Promise<void> {
    switch (msg.type) {
      case 'ACTIVITY_LOGGED':
        return this.handleActivityLogged(msg);
      case 'BACKFILL_ACTIVITY':
        return this.handleBackfillActivity(msg);
    }
  }

  private async handleBackfillActivity(msg: BackfillActivityMessage): Promise<void> {
    const label = msg.activityName.charAt(0).toUpperCase() + msg.activityName.slice(1);

    const { alreadyLogged } = await this.trackingRepository.logActivity(
      msg.guildId,
      msg.userId,
      msg.activityName,
      msg.date,
    );

    if (alreadyLogged) {
      await this.sendFollowup(
        msg.applicationId,
        msg.interactionToken,
        `⚠️ You already logged **${label}** on ${msg.date}.`,
      );
      return;
    }

    const { currentStreak } = await this.streakService.recomputeStreak(msg.guildId, msg.userId);

    const streakSuffix = currentStreak > 0 ? ` — 🔥 ${currentStreak}-day streak!` : '';
    await this.sendChannelMessage(
      msg.channelId,
      `<@${msg.userId}> backfilled **${label}** for ${msg.date}${streakSuffix}`,
    );
    await this.deleteOriginalResponse(msg.applicationId, msg.interactionToken);
  }

  private async handleActivityLogged(msg: ActivityLoggedMessage): Promise<void> {
    const date = msg.timestamp.slice(0, 10);

    const { alreadyLogged } = await this.trackingRepository.logActivity(
      msg.guildId,
      msg.userId,
      msg.activityName,
      date,
    );

    const label = msg.activityName.charAt(0).toUpperCase() + msg.activityName.slice(1);

    if (alreadyLogged) {
      // Ephemeral — via interaction webhook (defer was ephemeral, so followup is too)
      await this.sendFollowup(
        msg.applicationId,
        msg.interactionToken,
        `👍 Already logged **${label}** today!`,
      );
      return;
    }

    const { currentStreak } = await this.streakService.processActivityLogged(
      msg.guildId,
      msg.userId,
      msg.activityName,
      date,
    );

    const streakSuffix = currentStreak > 0 ? ` — **${currentStreak}-day** streak 🔥` : '';
    // Post the public message directly to the channel via bot token
    await this.sendChannelMessage(
      msg.channelId,
      `<@${msg.userId}> logged **${label}**${streakSuffix}`,
    );
    // Delete the ephemeral deferred response so "Spotter is thinking..." disappears
    await this.deleteOriginalResponse(msg.applicationId, msg.interactionToken);
  }

  private async deleteOriginalResponse(
    applicationId: string,
    interactionToken: string,
  ): Promise<void> {
    const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
      // Non-critical: log but don't throw — the activity was already recorded
      this.logger.warn(
        `Delete original response failed [${response.status}]: ${response.statusText}`,
      );
    }
  }

  private async sendChannelMessage(channelId: string, content: string): Promise<void> {
    const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${this.discordConfig.botToken}`,
      },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      throw new Error(`Channel message failed [${response.status}]: ${response.statusText}`);
    }
  }

  private async sendFollowup(
    applicationId: string,
    interactionToken: string,
    content: string,
  ): Promise<void> {
    const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, flags: 64 }), // always ephemeral — only used for error/duplicate cases
    });

    if (!response.ok) {
      throw new Error(`Discord followup failed [${response.status}]: ${response.statusText}`);
    }
  }
}
