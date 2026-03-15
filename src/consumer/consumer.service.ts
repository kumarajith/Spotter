import { Injectable, Logger } from '@nestjs/common';
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

    const streakSuffix = currentStreak > 0 ? ` Your streak: 🔥 ${currentStreak}-day streak!` : '';
    await this.sendFollowup(
      msg.applicationId,
      msg.interactionToken,
      `✅ Backfilled **${label}** for ${msg.date}.${streakSuffix}`,
    );
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
      await this.sendFollowup(
        msg.applicationId,
        msg.interactionToken,
        `⚠️ You already logged **${label}** today.`,
      );
      return;
    }

    const { currentStreak } = await this.streakService.processActivityLogged(
      msg.guildId,
      msg.userId,
      msg.activityName,
      date,
    );

    const streakSuffix = currentStreak > 1 ? ` 🔥 ${currentStreak}-day streak!` : '';
    await this.sendFollowup(
      msg.applicationId,
      msg.interactionToken,
      `✅ Logged **${label}**!${streakSuffix}`,
    );
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
      body: JSON.stringify({ content, flags: 64 }), // flags: 64 = ephemeral
    });

    if (!response.ok) {
      this.logger.error(`Discord followup failed [${response.status}]: ${response.statusText}`);
    }
  }
}
