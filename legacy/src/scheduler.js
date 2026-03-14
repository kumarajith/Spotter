import { getTrackedChannels, updatePanelMessageId, getAllUsersWithLogs } from './database.js';
import { buildTrackerPanel, buildStreakSummaryEmbed } from './utils/embeds.js';
import { calculateStreaks } from './utils/streakCalc.js';

const DAILY_HOUR_UTC = parseInt(process.env.DAILY_HOUR_UTC || '8', 10);

/**
 * Post (or repost) the tracker panel in a channel.
 * Deletes the old panel message if possible, sends a new one, and updates the DB.
 */
export async function postPanel(client, guildId, channelId, oldMessageId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  // Delete old panel
  if (oldMessageId) {
    try {
      const oldMsg = await channel.messages.fetch(oldMessageId);
      await oldMsg.delete();
    } catch {
      // Already deleted or missing
    }
  }

  // Post new panel
  const messages = buildTrackerPanel(guildId);
  let lastMsgId = null;
  for (const msg of messages) {
    const sent = await channel.send(msg);
    lastMsgId = sent.id;
  }

  updatePanelMessageId(lastMsgId, guildId, channelId);
}

/**
 * Post the daily streak summary in tracked channels.
 */
async function postStreakSummary(client) {
  const channels = getTrackedChannels();
  const guildGroups = new Map();

  for (const ch of channels) {
    if (!guildGroups.has(ch.guild_id)) {
      guildGroups.set(ch.guild_id, []);
    }
    guildGroups.get(ch.guild_id).push(ch);
  }

  for (const [guildId, chs] of guildGroups) {
    const userIds = getAllUsersWithLogs(guildId);
    const streakEntries = userIds
      .map(userId => {
        const { currentStreak } = calculateStreaks(guildId, userId);
        return { userId, streak: currentStreak };
      })
      .filter(e => e.streak >= 1)
      .sort((a, b) => b.streak - a.streak);

    if (streakEntries.length === 0) continue;

    const embed = buildStreakSummaryEmbed(streakEntries);

    for (const ch of chs) {
      try {
        const channel = await client.channels.fetch(ch.channel_id);
        await channel.send({ embeds: [embed] });
      } catch {
        // Channel unavailable
      }
    }
  }
}

/**
 * Run all daily tasks: repost panels + post streak summary.
 */
export async function runDailyTasks(client) {
  console.log('[Scheduler] Running daily tasks...');

  const channels = getTrackedChannels();
  for (const ch of channels) {
    await postPanel(client, ch.guild_id, ch.channel_id, ch.last_panel_message_id);
  }

  await postStreakSummary(client);

  console.log('[Scheduler] Daily tasks complete.');
}

/**
 * Start the scheduler. Checks every 60s if it's time to fire.
 */
export function startScheduler(client) {
  let lastFiredDate = null;

  const check = () => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const hour = now.getUTCHours();

    if (hour >= DAILY_HOUR_UTC && lastFiredDate !== todayStr) {
      lastFiredDate = todayStr;
      runDailyTasks(client).catch(err => console.error('[Scheduler] Error:', err));
    }
  };

  // Check every 60 seconds
  setInterval(check, 60_000);
  // Also check immediately on startup
  check();

  console.log(`[Scheduler] Started. Daily tasks will fire at ${DAILY_HOUR_UTC}:00 UTC.`);
}
