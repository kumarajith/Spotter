import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { DiscordConfigService } from '../common/config/discord-config-service';
import { todayUtc } from '../common/dates';
import { TrackedChannel } from '../common/types/models';
import { PanelRepository } from '../panel/panel.repository';
import { PanelService } from '../panel/panel.service';
import { StreakRepository } from '../tracking/streak.repository';
import { buildStreakSummaryEmbed } from '../panel/panel.builder';

export class SchedulerService {
  constructor(
    private readonly panelRepository: PanelRepository,
    private readonly panelService: PanelService,
    private readonly streakRepository: StreakRepository,
    private readonly discordConfig: DiscordConfigService,
  ) {}

  async runDailyTasks(): Promise<void> {
    console.log('[Scheduler] Starting daily tasks');

    const allChannels = await this.panelRepository.getAllTrackedChannels();
    if (allChannels.length === 0) {
      console.log('[Scheduler] No tracked channels found — nothing to do');
      return;
    }

    const channelsByGuild = new Map<string, TrackedChannel[]>();
    for (const channel of allChannels) {
      const existing = channelsByGuild.get(channel.guildId) ?? [];
      existing.push(channel);
      channelsByGuild.set(channel.guildId, existing);
    }

    for (const [guildId, channels] of channelsByGuild) {
      try {
        await this.processGuild(guildId, channels);
      } catch (err) {
        console.error(`[Scheduler] Failed to process guild ${guildId}`, err);
      }
    }

    console.log('[Scheduler] Daily tasks complete');
  }

  private async processGuild(guildId: string, channels: TrackedChannel[]): Promise<void> {
    // Streaks are derived from the logs as of today, so anyone who missed
    // yesterday already reads as 0 here — there is nothing to reset.
    const streaks = await this.streakRepository.getGuildStreaks(guildId, todayUtc());
    const summaryEmbed = buildStreakSummaryEmbed(streaks.filter((s) => s.currentStreak > 0));
    const rest = new REST({ version: '10' }).setToken(this.discordConfig.botToken);

    for (const { channelId, lastPanelMessageId } of channels) {
      try {
        await rest.post(Routes.channelMessages(channelId), {
          body: { embeds: [summaryEmbed] },
        });
      } catch (err) {
        console.error(`[Scheduler] Failed to post summary to channel ${channelId}`, err);
      }

      try {
        await this.panelService.repost(guildId, channelId, lastPanelMessageId);
      } catch (err) {
        console.error(`[Scheduler] Failed to repost panel to channel ${channelId}`, err);
      }
    }
  }
}
