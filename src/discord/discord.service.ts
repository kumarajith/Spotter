import { Injectable } from '@nestjs/common';
import {
  APIApplicationCommandAutocompleteInteraction,
  APIApplicationCommandInteraction,
  APIChatInputApplicationCommandInteraction,
  APIInteraction,
  APIMessageComponentInteraction,
  ComponentType,
} from 'discord-api-types/v10';
import { ActivityService } from '../activity/activity.service';
import { PanelService } from '../panel/panel.service';
import { TrackingService } from '../tracking/tracking.service';
import { COMMANDS } from './commands';
import { autocompleteResult, ephemeral, getStringOption } from './discord.utils';

@Injectable()
export class DiscordService {
  constructor(
    private readonly activityService: ActivityService,
    private readonly panelService: PanelService,
    private readonly trackingService: TrackingService,
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

    if (interaction.data.name === COMMANDS.REMOVE_ACTIVITY) {
      const focusedOption = (interaction.data.options ?? []).find(
        (opt) => (opt as { focused?: boolean }).focused,
      ) as { value?: string } | undefined;

      const typedValue = focusedOption?.value?.toLowerCase() ?? '';

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
    const { alreadyLogged } = await this.trackingService.log(guildId, userId, activityName);

    const label = activityName.charAt(0).toUpperCase() + activityName.slice(1);

    if (alreadyLogged) {
      return ephemeral(`⚠️ You already logged **${label}** today.`);
    }

    return ephemeral(`✅ Logged **${label}** for today! Keep it up 💪`);
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
