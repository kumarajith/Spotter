import { Injectable } from '@nestjs/common';
import {
  APIApplicationCommandAutocompleteInteraction,
  APIApplicationCommandInteraction,
  APIChatInputApplicationCommandInteraction,
  APIEmbed,
  APIInteraction,
  APIMessageComponentInteraction,
  ComponentType,
  InteractionResponseType,
  MessageFlags,
} from 'discord-api-types/v10';
import { ActivityService } from '../activity/activity.service';
import { PanelService } from '../panel/panel.service';
import { DiscordConfigService } from '../common/config/discord-config-service';
import { SqsService } from '../sqs/sqs.service';
import { StreakRepository } from '../tracking/streak.repository';
import { TrackingRepository } from '../tracking/tracking.repository';
import { ActivityLoggedMessage, BackfillActivityMessage } from '../common/types/sqs.types';
import { COMMANDS } from './commands';
import { autocompleteResult, embedResponse, ephemeral, getStringOption } from './discord.utils';

const EMBED_COLOR = 0x57f287; // Discord green
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class DiscordService {
  constructor(
    private readonly activityService: ActivityService,
    private readonly panelService: PanelService,
    private readonly discordConfig: DiscordConfigService,
    private readonly sqsService: SqsService,
    private readonly streakRepository: StreakRepository,
    private readonly trackingRepository: TrackingRepository,
  ) {}

  async handleCommand(interaction: APIApplicationCommandInteraction) {
    const guildId = interaction.guild_id;
    if (!guildId) {
      return ephemeral('This command can only be used in a server.');
    }

    switch (interaction.data.name) {
      case COMMANDS.ADD_ACTIVITY:
        return this.handleAddActivity(
          interaction as APIChatInputApplicationCommandInteraction,
          guildId,
        );
      case COMMANDS.REMOVE_ACTIVITY:
        return this.handleRemoveActivity(
          interaction as APIChatInputApplicationCommandInteraction,
          guildId,
        );
      case COMMANDS.SETUP:
        return this.handleSetup(interaction, guildId);
      case COMMANDS.STREAK:
        return this.handleStreak(interaction as APIChatInputApplicationCommandInteraction, guildId);
      case COMMANDS.LEADERBOARD:
        return this.handleLeaderboard(guildId);
      case COMMANDS.BACKFILL:
        return this.handleBackfill(
          interaction as APIChatInputApplicationCommandInteraction,
          guildId,
        );
      default:
        return ephemeral('Command not implemented yet.');
    }
  }

  async handleSetup(interaction: APIApplicationCommandInteraction, guildId: string) {
    const channelId = interaction.channel?.id;
    if (!channelId) {
      return ephemeral('Could not determine the channel.');
    }

    try {
      await this.panelService.setup(guildId, channelId);
      return ephemeral('✅ Tracker panel posted! This channel will get daily reposts.');
    } catch {
      return ephemeral('❌ Failed to post the tracker panel. Please try again.');
    }
  }

  async handleAutocomplete(interaction: APIApplicationCommandAutocompleteInteraction) {
    const guildId = interaction.guild_id;
    if (!guildId) return autocompleteResult([]);

    const focusedOption = (interaction.data.options ?? []).find(
      (opt) => (opt as { focused?: boolean }).focused,
    ) as { value?: string } | undefined;
    const typedValue = focusedOption?.value?.toLowerCase() ?? '';

    if (
      interaction.data.name === COMMANDS.REMOVE_ACTIVITY ||
      interaction.data.name === COMMANDS.BACKFILL
    ) {
      const activities = await this.activityService.getActivities(guildId);

      const choices = activities
        .filter((activity) => activity.displayName.toLowerCase().includes(typedValue))
        .slice(0, 25)
        .map((activity) => ({
          name: activity.emoji ? `${activity.emoji} ${activity.displayName}` : activity.displayName,
          value: activity.displayName,
        }));

      return autocompleteResult(choices);
    }

    return autocompleteResult([]);
  }

  async handleComponent(interaction: APIInteraction) {
    const componentInteraction = interaction as APIMessageComponentInteraction;

    if (componentInteraction.data.component_type !== ComponentType.Button) {
      return ephemeral('Unknown component.');
    }

    const { custom_id } = componentInteraction.data;

    if (custom_id.startsWith('log_activity:')) {
      return this.handleLogActivity(componentInteraction);
    }

    return ephemeral('Unknown component.');
  }

  private async handleLogActivity(interaction: APIMessageComponentInteraction) {
    const guildId = interaction.guild_id;
    if (!guildId) {
      return ephemeral('This can only be used in a server.');
    }

    const userId = interaction.member?.user.id ?? interaction.user?.id;
    if (!userId) {
      return ephemeral('Could not identify user.');
    }

    const channelId = interaction.channel?.id;
    if (!channelId) {
      return ephemeral('Could not determine channel.');
    }

    const activityName = interaction.data.custom_id.slice('log_activity:'.length);

    const message: ActivityLoggedMessage = {
      type: 'ACTIVITY_LOGGED',
      guildId,
      userId,
      activityName,
      timestamp: new Date().toISOString(),
      channelId,
      interactionToken: interaction.token,
      applicationId: this.discordConfig.applicationId,
    };

    await this.sqsService.send(message);

    // Ephemeral defer: "Bot is thinking..." only visible to the clicker.
    // Consumer posts the public log directly to the channel via bot token.
    return {
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: MessageFlags.Ephemeral },
    };
  }

  private async handleStreak(
    interaction: APIChatInputApplicationCommandInteraction,
    guildId: string,
  ) {
    const selfId = interaction.member?.user.id ?? interaction.user?.id ?? '';
    const targetUserId = getStringOption(interaction.data.options, 'user') ?? selfId;

    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = addDays(today, -29); // inclusive: today + 29 prior days = 30 days

    const [streakItem, rangeLogs, activityCounts] = await Promise.all([
      this.streakRepository.getStreak(guildId, targetUserId),
      this.trackingRepository.getUserLogsForRange(guildId, targetUserId, thirtyDaysAgo, today),
      this.trackingRepository.getUserActivityCounts(guildId, targetUserId),
    ]);

    if (!streakItem && rangeLogs.length === 0 && activityCounts.size === 0) {
      return ephemeral('No activity logged yet. Hit the buttons to start your streak!');
    }

    const currentStreak = streakItem?.currentStreak ?? 0;
    const longestStreak = streakItem?.longestStreak ?? 0;

    // Build heatmap grid: oldest → newest, rows of 10
    const logsByDate = new Map<string, { hasNonRest: boolean }>();
    for (const log of rangeLogs) {
      if (!logsByDate.has(log.date)) logsByDate.set(log.date, { hasNonRest: false });
      if (log.activityName.toLowerCase() !== 'rest') {
        logsByDate.get(log.date)!.hasNonRest = true;
      }
    }

    const gridEmoji: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const date = addDays(today, -i);
      const day = logsByDate.get(date);
      if (!day) gridEmoji.push('⬛');
      else if (day.hasNonRest) gridEmoji.push('🟩');
      else gridEmoji.push('🟦');
    }

    const heatmapRows: string[] = [];
    for (let i = 0; i < gridEmoji.length; i += 10) {
      heatmapRows.push(gridEmoji.slice(i, i + 10).join(''));
    }

    // Build activity breakdown: sorted by count DESC
    const breakdownLines = [...activityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => {
        const label = name.charAt(0).toUpperCase() + name.slice(1);
        return `${label} ×${count}`;
      });

    const isSelf = targetUserId === selfId;
    const resolvedUser = interaction.data.resolved?.users?.[targetUserId];
    const displayName = resolvedUser?.global_name ?? resolvedUser?.username ?? `<@${targetUserId}>`;

    const fields: APIEmbed['fields'] = [
      {
        name: '🔥 Current Streak',
        value:
          currentStreak > 0
            ? `${currentStreak} day${currentStreak === 1 ? '' : 's'}`
            : 'No active streak',
        inline: true,
      },
      {
        name: '🏆 Best Streak',
        value: longestStreak > 0 ? `${longestStreak} day${longestStreak === 1 ? '' : 's'}` : '—',
        inline: true,
      },
    ];

    if (breakdownLines.length > 0) {
      fields.push({ name: '📋 Activity Breakdown', value: breakdownLines.join('\n') });
    }

    fields.push({ name: '🗓️ Last 30 Days', value: heatmapRows.join('\n') });

    const embed: APIEmbed = {
      title: '📊 Streak Stats',
      description: isSelf ? 'Your activity stats' : `Stats for ${displayName}`,
      color: EMBED_COLOR,
      fields,
    };

    return embedResponse(embed, true);
  }

  private async handleLeaderboard(guildId: string) {
    const [currentTop, allStreaks] = await Promise.all([
      this.streakRepository.getTopCurrentStreaks(guildId),
      this.streakRepository.getAllGuildStreaks(guildId),
    ]);

    const allTimeTop = allStreaks
      .filter((s) => s.longestStreak > 0)
      .sort((a, b) => b.longestStreak - a.longestStreak)
      .slice(0, 10);

    if (currentTop.length === 0 && allTimeTop.length === 0) {
      return ephemeral('No streaks recorded yet. Start logging to get on the board!');
    }

    const formatCurrent = (items: typeof currentTop) =>
      items
        .map(
          (s, i) =>
            `${i + 1}. <@${s.userId}> — ${s.currentStreak} day${s.currentStreak === 1 ? '' : 's'} 🔥`,
        )
        .join('\n') || '—';

    const formatAllTime = (items: typeof allTimeTop) =>
      items
        .map(
          (s, i) =>
            `${i + 1}. <@${s.userId}> — ${s.longestStreak} day${s.longestStreak === 1 ? '' : 's'}`,
        )
        .join('\n') || '—';

    const embed: APIEmbed = {
      title: '🏅 Leaderboard',
      color: EMBED_COLOR,
      fields: [
        { name: '🔥 Current Streaks', value: formatCurrent(currentTop) },
        { name: '🏆 All-Time Best', value: formatAllTime(allTimeTop) },
      ],
    };

    return embedResponse(embed, false);
  }

  private async handleBackfill(
    interaction: APIChatInputApplicationCommandInteraction,
    guildId: string,
  ) {
    const userId = interaction.member?.user.id ?? interaction.user?.id;
    if (!userId) {
      return ephemeral('Could not identify user.');
    }

    const date = getStringOption(interaction.data.options, 'date');
    const activityName = getStringOption(interaction.data.options, 'activity')?.toLowerCase();

    if (!date || !activityName) {
      return ephemeral('Both date and activity are required.');
    }

    const today = new Date().toISOString().slice(0, 10);
    if (!DATE_RE.test(date) || date > today) {
      return ephemeral('❌ Invalid date. Use YYYY-MM-DD format and do not use a future date.');
    }

    const message: BackfillActivityMessage = {
      type: 'BACKFILL_ACTIVITY',
      guildId,
      userId,
      activityName,
      date,
      interactionToken: interaction.token,
      applicationId: this.discordConfig.applicationId,
    };

    await this.sqsService.send(message);

    return {
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: MessageFlags.Ephemeral },
    };
  }

  private async handleAddActivity(
    interaction: APIChatInputApplicationCommandInteraction,
    guildId: string,
  ) {
    const options = interaction.data.options ?? [];
    const name = getStringOption(options, 'name');
    const emoji = getStringOption(options, 'emoji') ?? '';

    if (!name) {
      return ephemeral('Activity name is required.');
    }

    try {
      const userId = interaction.member?.user.id ?? interaction.user?.id ?? 'unknown';
      await this.activityService.addActivity(guildId, name, emoji, userId);
      const display = emoji ? `${emoji} ${name}` : name;
      return ephemeral(
        `✅ Added activity **${display}**! It will appear on the tracker panel. Run \`/setup\` to refresh the panel now, or it'll update on the next daily repost.`,
      );
    } catch {
      return ephemeral(`❌ An activity named **${name}** already exists.`);
    }
  }

  private async handleRemoveActivity(
    interaction: APIChatInputApplicationCommandInteraction,
    guildId: string,
  ) {
    const options = interaction.data.options ?? [];
    const name = getStringOption(options, 'name');

    if (!name) {
      return ephemeral('Activity name is required.');
    }

    await this.activityService.removeActivity(guildId, name);
    return ephemeral(`✅ Removed **${name}**. Run \`/setup\` to refresh the panel.`);
  }
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
