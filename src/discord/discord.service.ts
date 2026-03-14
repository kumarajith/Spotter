import { Injectable } from '@nestjs/common';
import { APIInteraction } from 'discord-api-types/v10';

@Injectable()
export class DiscordService {
  handleCommand(interaction: APIInteraction) {}
  handleComponent(interaction: APIInteraction) {}
}
