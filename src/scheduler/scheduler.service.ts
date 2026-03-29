import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { DiscordConfigService } from '../common/config/discord-config-service';
import { PanelRepository } from '../panel/panel.repository';
import { PanelService } from '../panel/panel.service';
import { StreakRepository } from '../tracking/streak.repository';
import { buildStreakSummaryEmbed } from '../panel/panel.builder';
import { StreakItem } from '../common/types/dynamo.types';

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

    // Group channels by guildId (extracted from PK: "GUILD#<id>")
    const channelsByGuild = new Map<string, typeof allChannels>();
    for (const channel of allChannels) {
      const guildId = channel.PK.replace('GUILD#', '');
      const existing = channelsByGuild.get(guildId) ?? [];
      existing.push(channel);
      channelsByGuild.set(guildId, existing);
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

  private async processGuild(
    guildId: string,
    channels: Awaited<ReturnType<PanelRepository['getAllTrackedChannels']>>,
  ): Promise<void> {
    const allStreaks = await this.streakRepository.getAllGuildStreaks(guildId);

    // Reset stale streaks (lastLoggedDate < yesterday)
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const stale = allStreaks.filter((s) => s.currentStreak > 0 && s.lastLoggedDate < yesterdayStr);

    for (const streak of stale) {
      await this.resetStreak(streak);
    }

    // Build summary from streaks that survived the reset
    const activeStreaks = allStreaks
      .filter((s) => !(s.currentStreak > 0 && s.lastLoggedDate < yesterdayStr))
      .filter((s) => s.currentStreak > 0);

    const summaryEmbed = buildStreakSummaryEmbed(activeStreaks);
    const rest = new REST({ version: '10' }).setToken(this.discordConfig.botToken);

    for (const channel of channels) {
      const channelId = channel.SK.replace('CHANNEL#', '');

      // Post streak summary
      try {
        await rest.post(Routes.channelMessages(channelId), {
          body: { embeds: [summaryEmbed] },
        });
      } catch (err) {
        console.error(`[Scheduler] Failed to post summary to channel ${channelId}`, err);
      }

      // Repost panel
      try {
        await this.panelService.repost(guildId, channelId, channel.lastPanelMessageId);
      } catch (err) {
        console.error(`[Scheduler] Failed to repost panel to channel ${channelId}`, err);
      }
    }
  }

  private async resetStreak(streak: StreakItem): Promise<void> {
    // PutItem (overwrite) correctly handles GSI key attribute changes —
    // DynamoDB automatically replaces the old GSI entry with the new one.
    await this.streakRepository.putStreak({
      ...streak,
      currentStreak: 0,
      currentStreakPadded: '00000',
      GSI1SK: 'STREAK#00000',
      consecutiveRestOnlyDays: 0,
      lastDayHasNonRest: false,
      pendingBreakState: undefined,
      updatedAt: new Date().toISOString(),
    });
  }
}
