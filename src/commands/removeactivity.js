import { SlashCommandBuilder } from 'discord.js';
import { removeActivity, getActivities } from '../database.js';

export const data = new SlashCommandBuilder()
  .setName('removeactivity')
  .setDescription('Remove a custom activity from this server')
  .addStringOption(opt =>
    opt
      .setName('name')
      .setDescription('Activity name to remove')
      .setRequired(true)
      .setAutocomplete(true)
  );

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const all = getActivities(interaction.guildId);
  const filtered = all
    .filter(a => a.name.toLowerCase().includes(focused))
    .slice(0, 25);

  await interaction.respond(
    filtered.map(a => ({ name: a.emoji ? `${a.emoji} ${a.name}` : a.name, value: a.name }))
  );
}

export async function execute(interaction) {
  const name = interaction.options.getString('name');
  const result = removeActivity(interaction.guildId, name);

  if (result.changes === 0) {
    return interaction.reply({
      content: `❌ No activity named **${name}** found.`,
      flags: 64,
    });
  }

  return interaction.reply({
    content: `✅ Removed activity **${name}**. Run \`/setup\` to refresh the panel.`,
    flags: 64,
  });
}
