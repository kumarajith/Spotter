import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getActivities } from '../database.js';

export function buildTrackerPanel(guildId) {
  const activities = getActivities(guildId);
  const today = new Date().toISOString().slice(0, 10);

  const embed = new EmbedBuilder()
    .setTitle('💪 Fitness Tracker — tap to log today\'s activity')
    .setDescription(`📅 **${today}**\nTap a button below to log your workout. You can log multiple activities per day.`)
    .setColor(0x5865f2);

  const buttons = activities.map(act => {
    const btn = new ButtonBuilder()
      .setCustomId(`log_activity:${act.id}`)
      .setLabel(act.name)
      .setStyle(ButtonStyle.Secondary);

    if (act.emoji) {
      btn.setEmoji(act.emoji);
    }

    return btn;
  });

  // Split into rows of 5
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const row = new ActionRowBuilder().addComponents(buttons.slice(i, i + 5));
    rows.push(row);
  }

  // Discord limit: 5 rows per message
  if (rows.length <= 5) {
    return [{ embeds: [embed], components: rows }];
  }

  // Split across two messages
  return [
    { embeds: [embed], components: rows.slice(0, 5) },
    { components: rows.slice(5, 10) },
  ];
}

export function buildStreakEmbed(user, currentStreak, bestStreak, totalDays, activityCounts, last30DaysGrid) {
  const breakdown = activityCounts
    .map(a => `${a.emoji || '▪️'} **${a.name}** — ${a.count}`)
    .join('\n') || 'No activities logged yet.';

  const embed = new EmbedBuilder()
    .setTitle(`📊 Streak Stats — ${user.displayName || user.username}`)
    .setThumbnail(user.displayAvatarURL())
    .setColor(0x57f287)
    .addFields(
      { name: '🔥 Current Streak', value: `${currentStreak} day${currentStreak !== 1 ? 's' : ''}`, inline: true },
      { name: '🏆 Best Streak', value: `${bestStreak} day${bestStreak !== 1 ? 's' : ''}`, inline: true },
      { name: '📅 Total Active Days', value: `${totalDays}`, inline: true },
      { name: '📋 Activity Breakdown', value: breakdown },
      { name: '🗓️ Last 30 Days', value: last30DaysGrid },
    );

  return embed;
}

export function buildLeaderboardEmbed(currentStreaks, allTimeStreaks) {
  const formatList = (entries) => {
    if (entries.length === 0) return 'No streaks yet!';
    return entries
      .map((e, i) => `${i + 1}. <@${e.userId}> — ${e.streak} day${e.streak !== 1 ? 's' : ''} 🔥`)
      .join('\n');
  };

  return new EmbedBuilder()
    .setTitle('🏅 Leaderboard')
    .setColor(0xfee75c)
    .addFields(
      { name: '🔥 Current Streaks', value: formatList(currentStreaks) },
      { name: '🏆 All-Time Best', value: formatList(allTimeStreaks) },
    );
}

export function buildStreakSummaryEmbed(streakEntries) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = streakEntries.map(e => {
    const icon = e.streak >= 14 ? '🔥' : '💪';
    return `${icon} <@${e.userId}> — ${e.streak} days`;
  });

  return new EmbedBuilder()
    .setTitle(`📊 Active Streaks — ${today}`)
    .setDescription(lines.join(' | '))
    .setColor(0xed4245);
}
