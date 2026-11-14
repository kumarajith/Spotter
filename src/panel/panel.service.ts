import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { ActivityService } from '../activity/activity.service';
import { DiscordConfigService } from '../common/config/discord-config-service';
import { buildPanel } from './panel.builder';
import { PanelRepository } from './panel.repository';

export class PanelService {
  constructor(
    private readonly activityService: ActivityService,
    private readonly panelRepository: PanelRepository,
    private readonly discordConfig: DiscordConfigService,
  ) {}

  async setup(guildId: string, channelId: string): Promise<void> {
    await this.activityService.seedDefaults(guildId);
    await this.repost(guildId, channelId);
  }

  async repost(guildId: string, channelId: string, lastPanelMessageId?: string): Promise<void> {
    const activities = await this.activityService.getActivities(guildId);
    const rest = new REST({ version: '10' }).setToken(this.discordConfig.botToken);

    const oldMessageId =
      lastPanelMessageId ??
      (await this.panelRepository.getChannel(guildId, channelId))?.lastPanelMessageId;

    // Removing the old panel and posting the new one are independent calls to
    // Discord, several hundred milliseconds each. /setup has 3 seconds in total
    // to answer, so the removal runs while the new panel is being posted.
    // A failed removal (already deleted, or no access) is not a reason to stop.
    const removingOld: Promise<unknown> = oldMessageId
      ? rest.delete(Routes.channelMessage(channelId, oldMessageId)).catch(() => undefined)
      : Promise.resolve();

    const payloads = buildPanel(activities);
    let lastMessageId: string | undefined;

    for (const payload of payloads) {
      const sent = (await rest.post(Routes.channelMessages(channelId), {
        body: payload,
      })) as { id: string };
      lastMessageId = sent.id;
    }

    await removingOld;

    if (lastMessageId) {
      await this.panelRepository.upsertChannel(guildId, channelId, lastMessageId);
    }
  }
}
