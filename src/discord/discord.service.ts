import { Injectable } from '@nestjs/common';
import {
  APIInteraction,
  InteractionResponseType,
} from 'discord-api-types/v10';

@Injectable()
export class DiscordService {
  handleCommand(interaction: APIInteraction) {
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: 'Command not implemented yet.' },
    };
  }

  handleComponent(interaction: APIInteraction) {
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: 'Component not implemented yet.' },
    };
  }
}
