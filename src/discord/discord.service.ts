import {
  APIApplicationCommandAutocompleteInteraction,
  APIApplicationCommandInteraction,
  APIChatInputApplicationCommandInteraction,
  APIEmbed,
  APIInteraction,
  APIMessageComponentInteraction,
  ComponentType,
  InteractionResponseType,
} from 'discord-api-types/v10';
import { ActivityService } from '../activity/activity.service';
import { PanelService } from '../panel/panel.service';
import { DiscordConfigService } from '../common/config/discord-config-service';
import { addDays, todayUtc } from '../common/dates';
import { UserStreak } from '../common/types/models';
import { StreakRepository } from '../tracking/streak.repository';
import { TrackingRepository } from '../tracking/tracking.repository';
import { COMMANDS } from './commands';
import { autocompleteResult, embedResponse, ephemeral, getStringOption } from './discord.utils';

const EMBED_COLOR = 0x57f287; // Discord green
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class DiscordService {
  constructor(
    private readonly activityService: ActivityService,
    private readonly panelService: PanelService,
    private readonly discordConfig: DiscordConfigService,
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

    const activityName = interaction.data.custom_id.slice('log_activity:'.length);
    if (!activityName) {
      return ephemeral('Invalid activity.');
    }

    const today = todayUtc();
    const { alreadyLogged } = await this.trackingRepository.logActivity(
      guildId,
      userId,
      activityName,
      today,
    );

    const label = activityName.charAt(0).toUpperCase() + activityName.slice(1);

    if (alreadyLogged) {
      return ephemeral(`Already logged **${label}** today!`);
    }

    const { currentStreak } = await this.streakRepository.getUserStreak(guildId, userId, today);

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: `<@${userId}> logged **${label}** — **${currentStreak}-day** streak 🔥`,
      },
    };
  }

  private async handleStreak(
    interaction: APIChatInputApplicationCommandInteraction,
    guildId: string,
  ) {
    const selfId = interaction.member?.user.id ?? interaction.user?.id;
    if (!selfId) {
      return ephemeral('Could not identify user.');
    }
    const targetUserId = getStringOption(interaction.data.options, 'user') ?? selfId;

    const today = todayUtc();
    const thirtyDaysAgo = addDays(today, -29); // inclusive: today + 29 prior days = 30 days

    const [streak, rangeLogs, activityCounts] = await Promise.all([
      this.streakRepository.getUserStreak(guildId, targetUserId, today),
      this.trackingRepository.getUserLogsForRange(guildId, targetUserId, thirtyDaysAgo, today),
      this.trackingRepository.getUserActivityCounts(guildId, targetUserId),
    ]);

    if (streak.bestStreak === 0 && activityCounts.size === 0) {
      return ephemeral('No activity logged yet. Hit the buttons to start your streak!');
    }

    const currentStreak = streak.currentStreak;
    const longestStreak = streak.bestStreak;

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

    return embedResponse(embed, false);
  }

  private async handleLeaderboard(guildId: string) {
    const allStreaks = await this.streakRepository.getGuildStreaks(guildId, todayUtc());

    const top10 = (by: (s: UserStreak) => number) =>
      allStreaks
        .filter((s) => by(s) > 0)
        .sort((a, b) => by(b) - by(a) || a.userId.localeCompare(b.userId))
        .slice(0, 10);

    const currentTop = top10((s) => s.currentStreak);
    const allTimeTop = top10((s) => s.bestStreak);

    if (currentTop.length === 0 && allTimeTop.length === 0) {
      return ephemeral('No streaks recorded yet. Start logging to get on the board!');
    }

    const formatCurrent = (items: UserStreak[]) =>
      items
        .map(
          (s, i) =>
            `${i + 1}. <@${s.userId}> — ${s.currentStreak} day${s.currentStreak === 1 ? '' : 's'} 🔥`,
        )
        .join('\n') || '—';

    const formatAllTime = (items: UserStreak[]) =>
      items
        .map(
          (s, i) =>
            `${i + 1}. <@${s.userId}> — ${s.bestStreak} day${s.bestStreak === 1 ? '' : 's'}`,
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

    const today = todayUtc();
    if (!isRealDate(date) || date > today) {
      return ephemeral('❌ Invalid date. Use YYYY-MM-DD format and do not use a future date.');
    }

    const { alreadyLogged } = await this.trackingRepository.logActivity(
      guildId,
      userId,
      activityName,
      date,
    );

    const label = activityName.charAt(0).toUpperCase() + activityName.slice(1);

    if (alreadyLogged) {
      return ephemeral(`Already logged **${label}** on ${date}.`);
    }

    const { currentStreak } = await this.streakRepository.getUserStreak(guildId, userId, today);

    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: `<@${userId}> backfilled **${label}** for ${date} — **${currentStreak}-day** streak 🔥`,
      },
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
      const userId = interaction.member?.user.id ?? interaction.user?.id ?? 'system';
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

/**
 * True for a YYYY-MM-DD string that names a day that exists. The database
 * column is a real `date`, so "2025-02-31" has to be turned away here rather
 * than surface as a query error.
 */
function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
