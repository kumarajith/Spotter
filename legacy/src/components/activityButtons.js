import {
  getActivityById,
  logActivity,
  getLogForToday,
  getRecentActivities,
  getUserTotalLogs,
  getUserLogDates,
} from '../database.js';
import { calculateStreaks } from '../utils/streakCalc.js';
import encouragementRules from '../utils/encouragement.js';

export async function handleActivityButton(interaction) {
  const activityId = parseInt(interaction.customId.split(':')[1], 10);
  const activity = getActivityById(activityId);

  if (!activity) {
    return interaction.reply({ content: '❌ Activity not found.', flags: 64 });
  }

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  // Check if already logged today
  const existing = getLogForToday(guildId, userId, activityId, today);
  if (existing) {
    return interaction.reply({
      content: `👍 Already logged **${activity.name}** today!`,
      flags: 64,
    });
  }

  // Log the activity
  logActivity(guildId, userId, activityId, today, now);

  // Calculate streak
  const { currentStreak } = calculateStreaks(guildId, userId);

  // Build encouragement context
  const logDates = getUserLogDates(guildId, userId);
  const totalLogs = getUserTotalLogs(guildId, userId);

  // Recent activities: last 7 days (index 0 = today)
  const recentActivities = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const acts = getRecentActivities(guildId, userId, dateStr);
    if (acts.length === 0) {
      recentActivities.push(null);
    } else {
      // If any non-rest activity, report the first one; else 'Rest'
      const nonRest = acts.find(a => a !== 'Rest');
      recentActivities.push(nonRest || 'Rest');
    }
  }

  // Did user have a streak going into today?
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const hadStreakYesterday = logDates.includes(yesterdayStr);

  const context = {
    currentStreak,
    activityName: activity.name,
    recentActivities,
    hadStreakYesterday,
    totalLogs,
  };

  const messages = encouragementRules
    .map(rule => rule(context))
    .filter(Boolean);

  // Public message
  const display = activity.emoji ? `${activity.emoji} ${activity.name}` : activity.name;
  let publicMsg = `<@${userId}> logged **${display}** — **${currentStreak}-day** streak 🔥`;
  if (messages.length > 0) {
    publicMsg += '\n' + messages.join('\n');
  }

  await interaction.reply({ content: publicMsg });
}
