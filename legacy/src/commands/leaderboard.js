import { SlashCommandBuilder } from 'discord.js';
import { getAllUsersWithLogs } from '../database.js';
import { calculateStreaks } from '../utils/streakCalc.js';
import { buildLeaderboardEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Show top streaks for this server');

export async function execute(interaction) {
  const guildId = interaction.guildId;
  const userIds = getAllUsersWithLogs(guildId);

  const streakData = userIds.map(userId => {
    const { currentStreak, bestStreak } = calculateStreaks(guildId, userId);
    return { userId, currentStreak, bestStreak };
  });

  const currentStreaks = streakData
    .filter(e => e.currentStreak > 0)
    .sort((a, b) => b.currentStreak - a.currentStreak)
    .slice(0, 10)
    .map(e => ({ userId: e.userId, streak: e.currentStreak }));

  const allTimeStreaks = streakData
    .filter(e => e.bestStreak > 0)
    .sort((a, b) => b.bestStreak - a.bestStreak)
    .slice(0, 10)
    .map(e => ({ userId: e.userId, streak: e.bestStreak }));

  const embed = buildLeaderboardEmbed(currentStreaks, allTimeStreaks);

  return interaction.reply({ embeds: [embed] });
}
