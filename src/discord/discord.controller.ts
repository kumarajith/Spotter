import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { DiscordService } from './discord.service';
import * as v10 from 'discord-api-types/v10';
import { DiscordSignatureGuard } from './guards/discord-signature-guard';

@Controller('interactions')
export class DiscordController {
  constructor(private readonly discordService: DiscordService) {}

  @Post()
  @UseGuards(DiscordSignatureGuard)
  handleInteraction(@Body() interaction: v10.APIInteraction) {
    // Type 1: PING → return PONG
    if (interaction.type === v10.InteractionType.Ping) {
      return { type: v10.InteractionResponseType.Pong };
    }

    // Type 2: APPLICATION_COMMAND (slash commands)
    if (interaction.type === v10.InteractionType.ApplicationCommand) {
      return this.discordService.handleCommand(interaction);
    }

    // Type 3: MESSAGE_COMPONENT (button clicks)
    if (interaction.type === v10.InteractionType.MessageComponent) {
      return this.discordService.handleComponent(interaction);
    }

    // Type 4: APPLICATION_COMMAND_AUTOCOMPLETE
    if (interaction.type === v10.InteractionType.ApplicationCommandAutocomplete) {
      return this.discordService.handleAutocomplete(interaction);
    }
  }
}
