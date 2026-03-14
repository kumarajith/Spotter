import { SlashCommandBuilder } from 'discord.js';
import { getUserActivityCounts, getUserTotalDays, getUserLogDatesWithActivities } from '../database.js';
import { calculateStreaks } from '../utils/streakCalc.js';
import { buildStreakEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('streak')
  .setDescription('Show streak stats for a user')
  .addUserOption(opt =>
    opt.setName('user').setDescription('User to check (defaults to you)').setRequired(false)
  );

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('user') || interaction.user;
  const guildId = interaction.guildId;
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  const displayUser = member || targetUser;

  const { currentStreak, bestStreak } = calculateStreaks(guildId, targetUser.id);
  const totalDays = getUserTotalDays(guildId, targetUser.id);
  const activityCounts = getUserActivityCounts(guildId, targetUser.id);

  // Build 30-day heatmap
  const logsRaw = getUserLogDatesWithActivities(guildId, targetUser.id);
  const dateMap = new Map();
  for (const row of logsRaw) {
    if (!dateMap.has(row.logged_date)) {
      dateMap.set(row.logged_date, []);
    }
    dateMap.get(row.logged_date).push(row.activity_name);
  }

  const grid = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const acts = dateMap.get(dateStr);

    if (!acts) {
      grid.push('⬛');
    } else if (acts.every(a => a === 'Rest')) {
      grid.push('🟦');
    } else {
      grid.push('🟩');
    }
  }

  // Format grid into rows of 10
  let gridStr = '';
  for (let i = 0; i < grid.length; i += 10) {
    gridStr += grid.slice(i, i + 10).join('') + '\n';
  }
  gridStr += '🟩 active  🟦 rest  ⬛ no log';

  const embed = buildStreakEmbed(displayUser, currentStreak, bestStreak, totalDays, activityCounts, gridStr);

  return interaction.reply({ embeds: [embed] });
}
