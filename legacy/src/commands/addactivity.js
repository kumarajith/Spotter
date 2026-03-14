import { SlashCommandBuilder } from 'discord.js';
import { addActivity, getActivityByName, seedDefaults } from '../database.js';

export const data = new SlashCommandBuilder()
  .setName('addactivity')
  .setDescription('Add a custom activity for this server')
  .addStringOption(opt =>
    opt.setName('name').setDescription('Activity name').setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('emoji').setDescription('Emoji for the activity').setRequired(false)
  );

export async function execute(interaction) {
  const name = interaction.options.getString('name');
  const emoji = interaction.options.getString('emoji') || null;
  const guildId = interaction.guildId;

  // Ensure defaults exist
  seedDefaults(guildId);

  // Check for duplicates
  const existing = getActivityByName(guildId, name);
  if (existing) {
    return interaction.reply({
      content: `❌ An activity named **${name}** already exists.`,
      flags: 64,
    });
  }

  addActivity(guildId, name, emoji, interaction.user.id);

  const display = emoji ? `${emoji} ${name}` : name;
  return interaction.reply({
    content: `✅ Added activity **${display}**! It will appear on the tracker panel. Run \`/setup\` to refresh the panel now, or it'll update on the next daily repost.`,
    flags: 64,
  });
}
