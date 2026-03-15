import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from '@discordjs/builders';
import { ButtonStyle } from 'discord-api-types/v10';
import { ActivityItem } from '../common/types/dynamo.types';

export interface PanelPayload {
  embeds?: ReturnType<EmbedBuilder['toJSON']>[];
  components: ReturnType<ActionRowBuilder<ButtonBuilder>['toJSON']>[];
}

export function buildPanel(activities: ActivityItem[]): PanelPayload[] {
  const today = new Date().toISOString().slice(0, 10);

  const embed = new EmbedBuilder()
    .setTitle("💪 Fitness Tracker — tap to log today's activity")
    .setDescription(
      `📅 **${today}**\nTap a button below to log your workout. You can log multiple activities per day.`,
    )
    .setColor(0x5865f2);

  const buttons = activities.map((activity) => {
    const button = new ButtonBuilder()
      .setCustomId(`log_activity:${activity.displayName.toLowerCase()}`)
      .setLabel(activity.displayName)
      .setStyle(ButtonStyle.Secondary);

    if (activity.emoji) {
      button.setEmoji({ name: activity.emoji });
    }

    return button;
  });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }

  const serializedRows = rows.map((row) => row.toJSON());

  if (serializedRows.length <= 5) {
    return [{ embeds: [embed.toJSON()], components: serializedRows }];
  }

  // > 25 activities: split across two messages (Discord limit: 5 rows per message)
  return [
    { embeds: [embed.toJSON()], components: serializedRows.slice(0, 5) },
    { components: serializedRows.slice(5, 10) },
  ];
}
