import { Injectable } from '@nestjs/common';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { ActivityService } from '../activity/activity.service';
import { DiscordConfigService } from '../common/config/discord-config-service';
import { buildPanel } from './panel.builder';
import { PanelRepository } from './panel.repository';

@Injectable()
export class PanelService {
  constructor(
    private readonly activityService: ActivityService,
    private readonly panelRepository: PanelRepository,
    private readonly discordConfig: DiscordConfigService,
  ) {}

  async setup(guildId: string, channelId: string): Promise<void> {
    await this.activityService.seedDefaults(guildId);
    const activities = await this.activityService.getActivities(guildId);

    const rest = new REST({ version: '10' }).setToken(this.discordConfig.botToken);

    const existing = await this.panelRepository.getChannel(guildId, channelId);
    if (existing?.lastPanelMessageId) {
      try {
        await rest.delete(Routes.channelMessage(channelId, existing.lastPanelMessageId));
      } catch {
        // Message already deleted or bot lacks access — proceed
      }
    }

    const payloads = buildPanel(activities);
    let lastMessageId: string | undefined;

    for (const payload of payloads) {
      const sent = (await rest.post(Routes.channelMessages(channelId), {
        body: payload,
      })) as { id: string };
      lastMessageId = sent.id;
    }

    if (lastMessageId) {
      await this.panelRepository.upsertChannel(guildId, channelId, lastMessageId);
    }
  }
}
