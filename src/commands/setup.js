import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { seedDefaults, upsertTrackedChannel, getTrackedChannel } from '../database.js';
import { buildTrackerPanel } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Post the fitness tracker panel in this channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction) {
  await interaction.deferReply({ flags: 64 });

  const guildId = interaction.guildId;
  const channelId = interaction.channelId;

  // Seed default activities for this guild
  seedDefaults(guildId);

  // Delete old panel if exists
  const tracked = getTrackedChannel(guildId, channelId);
  if (tracked?.last_panel_message_id) {
    try {
      const oldMsg = await interaction.channel.messages.fetch(tracked.last_panel_message_id);
      await oldMsg.delete();
    } catch {
      // Message already deleted or missing
    }
  }

  // Post the panel
  const messages = buildTrackerPanel(guildId);
  let lastMsgId = null;
  for (const msg of messages) {
    const sent = await interaction.channel.send(msg);
    lastMsgId = sent.id;
  }

  // Track this channel
  upsertTrackedChannel(guildId, channelId, lastMsgId);

  await interaction.editReply('✅ Tracker panel posted! This channel will get daily reposts.');
}
