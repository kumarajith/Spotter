import { Injectable } from '@nestjs/common';
import {
  APIApplicationCommandInteraction,
  APIChatInputApplicationCommandInteraction,
  APIInteraction,
} from 'discord-api-types/v10';
import { ActivityService } from '../activity/activity.service';
import { PanelService } from '../panel/panel.service';
import { COMMANDS } from './commands';
import { ephemeral, getStringOption } from './discord.utils';

@Injectable()
export class DiscordService {
  constructor(
    private readonly activityService: ActivityService,
    private readonly panelService: PanelService,
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleComponent(_interaction: APIInteraction) {
    return ephemeral('Component not implemented yet.');
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
